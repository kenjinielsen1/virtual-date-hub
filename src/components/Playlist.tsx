import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useRoomChannel } from '../lib/RoomChannel'
import { labelForIdentity, type Identity, type Session } from '../lib/session'
import { extractVideoId } from '../lib/youtube'
import { ResetButton } from './ResetButton'

interface Track {
  id: string
  room_id: string
  title: string
  url: string
  note: string | null
  added_by: string | null
  created_at: string
}

type Source = 'youtube' | 'spotify' | 'apple' | 'other'

function detectSource(url: string): Source {
  if (extractVideoId(url)) return 'youtube'
  try {
    const h = new URL(url).hostname
    if (h.includes('spotify.com')) return 'spotify'
    if (h.includes('music.apple.com')) return 'apple'
  } catch {
    /* not a URL */
  }
  return 'other'
}

// Convert a share URL into an embeddable mini-player URL.
function embedUrl(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.hostname.includes('spotify.com'))
      return `https://open.spotify.com/embed${u.pathname}`
    if (u.hostname.includes('music.apple.com'))
      return `https://embed.music.apple.com${u.pathname}${u.search}`
  } catch {
    /* ignore */
  }
  return null
}

const SOURCE_BADGE: Record<Source, { label: string; className: string }> = {
  youtube: { label: '▶ YouTube', className: 'bg-red-100 text-red-600' },
  spotify: { label: '🎧 Spotify', className: 'bg-green-100 text-green-700' },
  apple: { label: '🍎 Apple Music', className: 'bg-stone-200 text-stone-700' },
  other: { label: '🔗 Link', className: 'bg-stone-100 text-stone-500' },
}

export function Playlist({ session }: { session: Session }) {
  const { broadcast, on } = useRoomChannel()
  const [tracks, setTracks] = useState<Track[]>([])
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [note, setNote] = useState('')
  const [queued, setQueued] = useState('')
  const [openId, setOpenId] = useState<string | null>(null) // expanded player

  useEffect(() => {
    let cancelled = false
    supabase
      .from('playlist')
      .select('*')
      .eq('room_id', session.roomCode)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (cancelled || !data) return
        // Merge, don't replace: a track added (or received live) before this
        // load resolves must not get clobbered.
        setTracks((prev) => {
          const byId = new Map(prev.map((t) => [t.id, t]))
          for (const t of data as Track[]) if (!byId.has(t.id)) byId.set(t.id, t)
          return [...byId.values()].sort((a, b) =>
            a.created_at.localeCompare(b.created_at),
          )
        })
      })
    return () => {
      cancelled = true
    }
  }, [session.roomCode])

  useEffect(() => {
    const offNew = on('playlist:new', (p) => {
      const t = p as Track
      setTracks((prev) => (prev.some((x) => x.id === t.id) ? prev : [...prev, t]))
    })
    const offDel = on('playlist:delete', (p) => {
      const { id } = p as { id: string }
      setTracks((prev) => prev.filter((t) => t.id !== id))
    })
    const offReset = on('playlist:reset', () => setTracks([]))
    return () => {
      offNew()
      offDel()
      offReset()
    }
  }, [on])

  async function add() {
    if (!title.trim() || !url.trim()) return
    const track: Track = {
      id: crypto.randomUUID(),
      room_id: session.roomCode,
      title: title.trim(),
      url: url.trim(),
      note: note.trim() || null,
      added_by: session.identity,
      created_at: new Date().toISOString(),
    }
    setTracks((prev) => [...prev, track])
    broadcast('playlist:new', track)
    setTitle('')
    setUrl('')
    setNote('')
    await supabase.from('playlist').insert({
      id: track.id,
      room_id: track.room_id,
      title: track.title,
      url: track.url,
      note: track.note,
      added_by: track.added_by,
    })
  }

  async function remove(id: string) {
    setTracks((prev) => prev.filter((t) => t.id !== id))
    broadcast('playlist:delete', { id })
    await supabase.from('playlist').delete().eq('id', id)
  }

  function resetPlaylist() {
    setTracks([])
    broadcast('playlist:reset', {})
    supabase.from('playlist').delete().eq('room_id', session.roomCode).then(() => {})
  }

  // Send a YouTube track over to the Watch Party (same events it listens to).
  function queueToWatch(t: Track) {
    const videoId = extractVideoId(t.url)
    if (!videoId) return
    broadcast('watch:video', { videoId, url: t.url })
    supabase
      .from('room_state')
      .upsert({
        room_id: session.roomCode,
        video_url: t.url,
        playback_state: { playing: false, time: 0, at: Date.now() },
      })
      .then(() => {})
    setQueued(t.id)
    window.setTimeout(() => setQueued(''), 4000)
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Add track */}
      <div className="rounded-2xl bg-paper ring-1 ring-ink/10 shadow-sm p-6 flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-stone-800">🎵 Our Playlist</h2>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Song title"
            className="flex-1 rounded-xl border border-stone-200 px-3 py-2 outline-none focus:ring-2 focus:ring-seal-300"
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="YouTube or Spotify link"
            className="flex-1 rounded-xl border border-stone-200 px-3 py-2 outline-none focus:ring-2 focus:ring-seal-300"
          />
        </div>
        <div className="flex gap-3">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="Why I picked this… (optional)"
            className="flex-1 rounded-xl border border-stone-200 px-3 py-2 outline-none focus:ring-2 focus:ring-seal-300"
          />
          <button
            type="button"
            onClick={add}
            disabled={!title.trim() || !url.trim()}
            className="rounded-xl bg-seal-500 text-white px-5 py-2 font-medium hover:bg-seal-600 disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>

      {/* Track list */}
      <div className="rounded-2xl bg-paper ring-1 ring-ink/10 shadow-sm p-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-stone-500">
            {tracks.length} track{tracks.length === 1 ? '' : 's'}
          </h3>
          {tracks.length > 0 && (
            <ResetButton
              label="Clear playlist"
              confirm="Delete the whole playlist for both of you?"
              onReset={resetPlaylist}
            />
          )}
        </div>

        {tracks.length === 0 ? (
          <p className="text-stone-400 text-sm text-center py-6">
            No songs yet — add one you want to share 🎶
          </p>
        ) : (
          <ul className="space-y-3">
            {tracks.map((t) => {
              const source = detectSource(t.url)
              const badge = SOURCE_BADGE[source]
              const embed = embedUrl(t.url)
              const isOpen = openId === t.id
              return (
                <li
                  key={t.id}
                  className="rounded-2xl border border-stone-100 bg-white p-4 flex flex-col gap-3"
                >
                  <div className="flex gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <a
                          href={t.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-stone-800 hover:text-seal-600 break-words"
                        >
                          {t.title} ↗
                        </a>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      </div>
                      {t.note && (
                        <p className="text-sm text-stone-500 mt-0.5 italic">
                          “{t.note}”
                        </p>
                      )}
                      <p className="text-xs text-stone-400 mt-1">
                        added by{' '}
                        {t.added_by
                          ? labelForIdentity(t.added_by as Identity)
                          : 'someone'}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {source === 'youtube' && (
                        <button
                          type="button"
                          onClick={() => queueToWatch(t)}
                          className="rounded-lg bg-seal-100 text-seal-700 px-2.5 py-1 text-xs font-medium hover:bg-seal-200"
                        >
                          ▶ Watch Party
                        </button>
                      )}
                      {embed && (
                        <button
                          type="button"
                          onClick={() => setOpenId(isOpen ? null : t.id)}
                          className="rounded-lg bg-stone-100 text-stone-600 px-2.5 py-1 text-xs font-medium hover:bg-stone-200"
                        >
                          {isOpen ? 'Hide' : '▶ Play here'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => remove(t.id)}
                        className="text-xs text-stone-400 hover:text-red-500"
                      >
                        remove
                      </button>
                      {queued === t.id && (
                        <span className="text-[11px] text-green-600">
                          loaded — open Watch Party
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Inline embedded player (each person plays their own). */}
                  {isOpen && embed && (
                    <iframe
                      title={t.title}
                      src={embed}
                      className="w-full rounded-xl"
                      height={source === 'apple' ? 175 : 152}
                      allow="autoplay *; encrypted-media *;"
                      loading="lazy"
                    />
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
