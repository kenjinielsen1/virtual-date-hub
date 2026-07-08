import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useRoomChannel } from '../lib/RoomChannel'
import { labelForIdentity, type Identity, type Session } from '../lib/session'
import { useReactions } from '../lib/reactions'
import { ReactionBar } from './ReactionBar'

// --- Codec strategy (the spec's #1 gotcha) --------------------------------
// Prefer AAC-in-mp4: both iPhones and modern desktop Chrome can record it,
// and everything can play it. (Codec diagnostic stays visible below until the
// cross-device test is done.)
const MIME_CANDIDATES = [
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
]

function pickRecordMime(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  for (const c of MIME_CANDIDATES)
    if (MediaRecorder.isTypeSupported(c)) return c
  return ''
}

function extFor(mime: string) {
  if (mime.includes('mp4')) return 'm4a'
  if (mime.includes('ogg')) return 'ogg'
  return 'webm'
}

function fmt(sec: number) {
  const m = Math.floor(sec / 60)
  return `${m}:${String(Math.round(sec % 60)).padStart(2, '0')}`
}

function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

interface VoiceNote {
  id: string
  room_id: string
  sender: string
  audio_url: string // storage PATH; signed for playback
  duration_seconds: number | null
  played: boolean
  created_at: string
}

const SIGN_TTL = 60 * 60 * 24 * 7 // 7 days

export function VoiceNotes({ session }: { session: Session }) {
  const { broadcast, on } = useRoomChannel()
  const { reactionsFor, toggle } = useReactions(session)

  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [notes, setNotes] = useState<VoiceNote[]>([])
  const [urls, setUrls] = useState<Map<string, string>>(new Map()) // path -> signed

  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAt = useRef(0)
  const timerRef = useRef<number | undefined>(undefined)

  const diag = useMemo(() => {
    const a = typeof Audio !== 'undefined' ? new Audio() : null
    return {
      recorder: typeof MediaRecorder !== 'undefined',
      recordsAs: pickRecordMime() || '(browser default)',
      playsMp4: a ? a.canPlayType('audio/mp4') || 'no' : '?',
      playsWebmOpus: a ? a.canPlayType('audio/webm; codecs="opus"') || 'no' : '?',
    }
  }, [])

  // Sign playback URLs for any paths we haven't signed yet.
  async function signPaths(paths: string[]) {
    const missing = paths.filter((p) => !urls.has(p))
    if (missing.length === 0) return
    const { data } = await supabase.storage
      .from('voice-notes')
      .createSignedUrls(missing, SIGN_TTL)
    if (!data) return
    setUrls((prev) => {
      const next = new Map(prev)
      data.forEach((d, i) => d.signedUrl && next.set(missing[i], d.signedUrl))
      return next
    })
  }

  // Load history.
  useEffect(() => {
    let cancelled = false
    supabase
      .from('voice_notes')
      .select('*')
      .eq('room_id', session.roomCode)
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data }) => {
        if (cancelled || !data) return
        const rows = data as VoiceNote[]
        setNotes((prev) => {
          const byId = new Map(prev.map((n) => [n.id, n]))
          for (const n of rows) if (!byId.has(n.id)) byId.set(n.id, n)
          return [...byId.values()].sort((a, b) =>
            b.created_at.localeCompare(a.created_at),
          )
        })
        signPaths(rows.map((r) => r.audio_url))
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.roomCode])

  // Live: new notes + played receipts.
  useEffect(() => {
    const offNew = on('voice:new', (p) => {
      const n = p as VoiceNote
      setNotes((prev) => (prev.some((x) => x.id === n.id) ? prev : [n, ...prev]))
      signPaths([n.audio_url])
    })
    const offPlayed = on('voice:played', (p) => {
      const { id } = p as { id: string }
      setNotes((prev) =>
        prev.map((n) => (n.id === id ? { ...n, played: true } : n)),
      )
    })
    return () => {
      offNew()
      offPlayed()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on])

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
      if (recRef.current?.state === 'recording') recRef.current.stop()
    }
  }, [])

  // Mic access only on the tap — never on load.
  async function start() {
    setError('')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setError(
        'Microphone access was blocked. Allow the mic for this site, then try again.',
      )
      return
    }
    try {
      const mime = pickRecordMime()
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunksRef.current = []
      rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data)
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        const type = rec.mimeType || mime || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type })
        const seconds = Math.max(1, Math.round((Date.now() - startedAt.current) / 1000))
        void upload(blob, type, seconds)
      }
      rec.start(250)
      recRef.current = rec
      startedAt.current = Date.now()
      setElapsed(0)
      timerRef.current = window.setInterval(
        () => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)),
        500,
      )
      setRecording(true)
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop())
      setError(e instanceof Error ? `Couldn't record: ${e.message}` : "Couldn't record.")
    }
  }

  function stop() {
    recRef.current?.stop()
    if (timerRef.current) window.clearInterval(timerRef.current)
    setRecording(false)
  }

  // Blob -> private bucket -> row -> live broadcast.
  async function upload(blob: Blob, mime: string, seconds: number) {
    setUploading(true)
    setError('')
    try {
      const path = `${session.roomCode}/${crypto.randomUUID()}.${extFor(mime)}`
      const { error: upErr } = await supabase.storage
        .from('voice-notes')
        .upload(path, blob, { contentType: mime })
      if (upErr) throw upErr
      const { data: row, error: insErr } = await supabase
        .from('voice_notes')
        .insert({
          room_id: session.roomCode,
          sender: session.identity,
          audio_url: path,
          duration_seconds: seconds,
        })
        .select()
        .single()
      if (insErr) throw insErr
      setNotes((prev) => [row as VoiceNote, ...prev])
      await signPaths([path])
      broadcast('voice:new', row)
    } catch (e) {
      setError(
        e instanceof Error ? `Couldn't send: ${e.message}` : "Couldn't send.",
      )
    } finally {
      setUploading(false)
    }
  }

  // First play by the receiver marks it heard (and tells the sender).
  function markPlayed(n: VoiceNote) {
    if (n.played || n.sender === session.identity) return
    setNotes((prev) =>
      prev.map((x) => (x.id === n.id ? { ...x, played: true } : x)),
    )
    broadcast('voice:played', { id: n.id })
    supabase.from('voice_notes').update({ played: true }).eq('id', n.id).then(() => {})
  }

  return (
    <div className="rounded-2xl bg-paper ring-1 ring-ink/10 shadow-sm p-6 flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-stone-800">🎙 Voice Notes</h2>

      {!diag.recorder ? (
        <p className="text-red-500 text-sm">
          This browser doesn’t support audio recording.
        </p>
      ) : recording ? (
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={stop}
            className="rounded-full w-16 h-16 bg-seal-600 text-cream text-2xl shadow-md hover:bg-seal-700 animate-pulse"
            aria-label="stop recording"
          >
            ■
          </button>
          <span className="tabular-nums text-2xl text-stone-700">{fmt(elapsed)}</span>
          <span className="text-sm text-stone-400">recording… tap to send</span>
        </div>
      ) : (
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={start}
            disabled={uploading}
            className="rounded-full w-16 h-16 bg-seal-500 text-cream text-2xl shadow-md hover:bg-seal-600 disabled:opacity-50"
            aria-label="start recording"
          >
            ●
          </button>
          <span className="text-sm text-stone-500">
            {uploading ? 'Sending…' : `Record a little hello for ${labelForIdentity(session.identity === 'me' ? 'her' : 'me')}`}
          </span>
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      {notes.length === 0 ? (
        <p className="text-stone-400 text-sm text-center py-4">
          No voice notes yet — leave the first one 🎙
        </p>
      ) : (
        <div className="space-y-3">
          {notes.map((n) => {
            const mine = n.sender === session.identity
            const unheard = !n.played && !mine
            const url = urls.get(n.audio_url)
            return (
              <div
                key={n.id}
                className={`rounded-xl border p-3 ${
                  unheard
                    ? 'border-gold-300 bg-gold-50/60'
                    : 'border-stone-100 bg-white'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium text-stone-600 flex items-center gap-1.5">
                    {unheard && (
                      <span className="w-2 h-2 rounded-full bg-gold-400 animate-pulse" />
                    )}
                    <span className="font-script text-lg leading-none">
                      {labelForIdentity(n.sender as Identity)}
                    </span>
                  </span>
                  <span className="text-xs text-stone-400">
                    {n.duration_seconds ? fmt(Number(n.duration_seconds)) + ' · ' : ''}
                    {timeAgo(n.created_at)}
                    {mine && n.played && ' · heard ✓'}
                  </span>
                </div>
                {url ? (
                  <audio
                    controls
                    preload="metadata"
                    src={url}
                    className="w-full h-10"
                    onPlay={() => markPlayed(n)}
                  />
                ) : (
                  <p className="text-xs text-stone-400">loading audio…</p>
                )}
                <ReactionBar
                  reactions={reactionsFor('voice_note', n.id)}
                  me={session.identity}
                  onToggle={(e) => toggle('voice_note', n.id, e)}
                />
              </div>
            )
          })}
        </div>
      )}

      {/* Codec readout — keep until the iPhone test is done. */}
      <div
        data-testid="codec-diag"
        className="rounded-xl bg-stone-50 p-3 text-xs text-stone-500 leading-relaxed"
      >
        <span className="font-medium text-stone-600">This device:</span> records
        as <b>{diag.recordsAs}</b> · plays mp4: <b>{diag.playsMp4}</b> · plays
        webm/opus: <b>{diag.playsWebmOpus}</b>
      </div>
    </div>
  )
}
