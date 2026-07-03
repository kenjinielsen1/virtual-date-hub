import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useRoomChannel } from '../lib/RoomChannel'
import type { Session } from '../lib/session'
import { extractVideoId, loadYouTubeAPI, type YTPlayer } from '../lib/youtube'
import { Chat } from './Chat'
import { ResetButton } from './ResetButton'

// Authoritative playback state we sync around. `time` is the video position in
// seconds at wall-clock `at` (Date.now() ms). Followers predict the live
// position from these two.
interface PlaybackState {
  playing: boolean
  time: number
  at: number
}

interface VideoBroadcast {
  videoId: string
  url: string
}

// How far the two players may drift before we forcibly re-sync (spec: ~1s).
const DRIFT_CORRECT = 1.0
// A jump larger than this is treated as an intentional seek and re-broadcast.
const SEEK_BROADCAST = 2.0

export function WatchParty({ session }: { session: Session }) {
  const { broadcast, on } = useRoomChannel()
  const [urlInput, setUrlInput] = useState('')
  const [videoId, setVideoId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [playerError, setPlayerError] = useState('')

  const containerRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<YTPlayer | null>(null)
  // When true, we're applying a remote/self change and must NOT re-broadcast.
  const applyingRemote = useRef(false)
  // Last authoritative state (from a local action or the partner).
  const lastState = useRef<PlaybackState | null>(null)
  const stateEnumRef = useRef<{ PLAYING: number; PAUSED: number } | null>(null)
  // Tracks whether the player's onReady has fired (state closures go stale).
  const readyRef = useRef(false)

  function persist(fields: Record<string, unknown>) {
    supabase
      .from('room_state')
      .upsert({
        room_id: session.roomCode,
        ...fields,
        updated_at: new Date().toISOString(),
      })
      .then(() => {})
  }

  // Broadcast + record a local playback change.
  function sendState(playing: boolean, time: number) {
    const payload: PlaybackState = { playing, time, at: Date.now() }
    lastState.current = payload
    broadcast('watch:sync', payload)
    persist({ playback_state: payload })
  }

  // Apply a playback state coming from the partner (or restored from DB).
  function applyState(payload: PlaybackState) {
    const player = playerRef.current
    if (!player) return
    lastState.current = payload
    applyingRemote.current = true
    const target = payload.playing
      ? payload.time + (Date.now() - payload.at) / 1000
      : payload.time
    player.seekTo(target, true)
    if (payload.playing) player.playVideo()
    else player.pauseVideo()
    // Release the guard after the player settles.
    window.setTimeout(() => (applyingRemote.current = false), 700)
  }

  // --- Create the player once the API + a videoId + container are ready. ---
  useEffect(() => {
    if (!videoId || !containerRef.current) return
    let cancelled = false
    setPlayerError('')

    // If the API/player never becomes ready, surface a hint (usually an
    // ad-blocker or privacy extension blocking YouTube).
    readyRef.current = false
    const readyTimeout = window.setTimeout(() => {
      // The player object is created instantly, but if the embed is blocked
      // onReady never fires — that's the real signal something is wrong.
      if (!cancelled && !readyRef.current) {
        setPlayerError(
          'The YouTube player never finished loading. This is almost always an ad-blocker or privacy extension (uBlock, Brave Shields, Privacy Badger) blocking the video embed — pause it for this site and reload, or open in a normal browser window.',
        )
      }
    }, 6000)

    loadYouTubeAPI()
      .then((YT) => {
      if (cancelled || !containerRef.current) return
      stateEnumRef.current = {
        PLAYING: YT.PlayerState.PLAYING,
        PAUSED: YT.PlayerState.PAUSED,
      }

      // Reuse an existing player if we already have one — just load the video.
      if (playerRef.current) {
        playerRef.current.loadVideoById(videoId)
        return
      }

      // The YT API REPLACES the element we pass it with an <iframe>. If we hand
      // it a React-rendered node, React later clobbers the iframe. So we append
      // our own child node that React doesn't manage and let YT replace that.
      const mount = document.createElement('div')
      mount.style.width = '100%'
      mount.style.height = '100%'
      containerRef.current.appendChild(mount)

      playerRef.current = new YT.Player(mount, {
        width: '100%',
        height: '100%',
        videoId,
        playerVars: { rel: 0, modestbranding: 1 },
        events: {
          onReady: () => {
            window.clearTimeout(readyTimeout)
            readyRef.current = true
            setReady(true)
            setPlayerError('')
            // Only re-apply state when there's something to restore (a video
            // already in progress). For a fresh load we leave the player in its
            // cued state — calling seek/pause here can leave it stuck on black.
            const s = lastState.current
            if (s && (s.playing || s.time > 0.5)) applyState(s)
          },
          onStateChange: (e) => {
            if (applyingRemote.current) return
            const en = stateEnumRef.current
            if (!en) return
            const t = e.target.getCurrentTime()
            if (e.data === en.PLAYING) sendState(true, t)
            else if (e.data === en.PAUSED) sendState(false, t)
          },
          onError: () => {
            window.clearTimeout(readyTimeout)
            setPlayerError(
              'This video can’t be embedded (the uploader disabled embedding, or it’s age/region-restricted). Try a different video.',
            )
          },
        },
      })
      })
      .catch((err) => {
        window.clearTimeout(readyTimeout)
        console.error('[WatchParty] YouTube API failed to load:', err)
        setPlayerError(
          'Couldn’t load YouTube. An ad-blocker or privacy extension is usually the cause — disable it for localhost and reload.',
        )
      })

    return () => {
      cancelled = true
      window.clearTimeout(readyTimeout)
      playerRef.current?.destroy()
      playerRef.current = null
      setReady(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId])

  // --- Poll for drift + intentional seeks while a video is loaded. ---
  useEffect(() => {
    const id = window.setInterval(() => {
      const player = playerRef.current
      const last = lastState.current
      if (!player || !last || !ready || applyingRemote.current) return

      const predicted = last.playing
        ? last.time + (Date.now() - last.at) / 1000
        : last.time
      const cur = player.getCurrentTime()
      const drift = cur - predicted

      if (Math.abs(drift) > SEEK_BROADCAST) {
        // Big jump → someone scrubbed the timeline. Broadcast it.
        sendState(last.playing, cur)
      } else if (last.playing && Math.abs(drift) > DRIFT_CORRECT) {
        // Small accumulated drift while playing → silently snap back.
        applyingRemote.current = true
        player.seekTo(predicted, true)
        window.setTimeout(() => (applyingRemote.current = false), 400)
      }
    }, 800)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  // --- Subscribe to partner events on the shared channel. ---
  useEffect(() => {
    const offSync = on('watch:sync', (p) => applyState(p as PlaybackState))
    const offVideo = on('watch:video', (p) => {
      const v = p as VideoBroadcast
      setUrlInput(v.url)
      setVideoId(v.videoId)
    })
    const offReset = on('watch:reset', () => clearVideoLocal())
    return () => {
      offSync()
      offVideo()
      offReset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on])

  // --- On mount, restore the room's current video + playback from the DB. ---
  useEffect(() => {
    let cancelled = false
    supabase
      .from('room_state')
      .select('video_url, playback_state')
      .eq('room_id', session.roomCode)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return
        if (data.playback_state)
          lastState.current = data.playback_state as PlaybackState
        if (data.video_url) {
          const id = extractVideoId(data.video_url)
          if (id) {
            setUrlInput(data.video_url)
            setVideoId(id)
          }
        }
      })
    return () => {
      cancelled = true
    }
  }, [session.roomCode])

  function loadVideo() {
    const id = extractVideoId(urlInput)
    if (!id) {
      setError('That doesn’t look like a YouTube link.')
      return
    }
    setError('')
    setVideoId(id)
    lastState.current = { playing: false, time: 0, at: Date.now() }
    broadcast('watch:video', { videoId: id, url: urlInput } satisfies VideoBroadcast)
    persist({ video_url: urlInput, playback_state: lastState.current })
  }

  function clearVideoLocal() {
    setVideoId(null)
    setUrlInput('')
    setError('')
    lastState.current = null
  }

  function resetVideo() {
    clearVideoLocal()
    broadcast('watch:reset', {})
    persist({ video_url: null, playback_state: null })
  }

  return (
    <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
      {/* Player side */}
      <div className="flex-1 flex flex-col gap-3 min-w-0">
        <div className="flex gap-2">
          <input
            value={urlInput}
            onChange={(e) => {
              setUrlInput(e.target.value)
              setError('')
            }}
            onKeyDown={(e) => e.key === 'Enter' && loadVideo()}
            placeholder="Paste a YouTube link…"
            className="flex-1 rounded-xl border border-stone-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-seal-300"
          />
          <button
            type="button"
            onClick={loadVideo}
            className="rounded-xl bg-seal-500 text-white px-4 py-2 text-sm font-medium hover:bg-seal-600 transition"
          >
            Load
          </button>
        </div>
        <div className="flex items-center justify-between">
          {error ? (
            <p className="text-sm text-red-500">{error}</p>
          ) : (
            <span />
          )}
          {videoId && (
            <ResetButton
              label="Clear video"
              confirm="Clear the current video for both of you?"
              onReset={resetVideo}
            />
          )}
        </div>

        <div className="relative aspect-video w-full rounded-2xl overflow-hidden bg-black/90 flex items-center justify-center">
          {videoId ? (
            <div ref={containerRef} className="w-full h-full" />
          ) : (
            <p className="text-stone-400 text-sm p-6 text-center">
              Paste a YouTube link above to start watching together. Play, pause
              and seek stay in sync for both of you.
            </p>
          )}
          {/* Overlay sits on top so we never unmount the player container. */}
          {playerError && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-6">
              <p className="text-amber-200 text-sm text-center max-w-sm">
                {playerError}
              </p>
            </div>
          )}
        </div>

        {/* Escape hatch: if an embed won't render (e.g. a browser/OS block),
            you can still open the video directly. */}
        {videoId && (
          <a
            href={`https://www.youtube.com/watch?v=${videoId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-stone-400 hover:text-stone-600 self-start"
          >
            Video not showing? Open on YouTube ↗
          </a>
        )}
      </div>

      {/* Chat side panel (reused from Phase 2) */}
      <div className="lg:w-80 flex flex-col rounded-2xl bg-white/70 ring-1 ring-ink/10 p-3 min-h-[300px] lg:min-h-0">
        <h3 className="text-sm font-semibold text-stone-600 mb-2 px-1">Chat</h3>
        <div className="flex-1 min-h-0">
          <Chat session={session} />
        </div>
      </div>
    </div>
  )
}
