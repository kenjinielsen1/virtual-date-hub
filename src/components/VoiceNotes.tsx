import { useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '../lib/session'

// --- Codec strategy (the spec's #1 gotcha) --------------------------------
// iPhones record audio/mp4 (AAC); desktop Chrome records audio/webm (opus).
// We PREFER audio/mp4 when the recorder supports it, because mp4 plays
// everywhere (including iOS); webm playback on iPhones is the weak link.
const MIME_CANDIDATES = [
  'audio/mp4;codecs=mp4a.40.2', // AAC-in-mp4: plays on everything, incl. iOS
  'audio/mp4',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
]

function pickRecordMime(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  for (const c of MIME_CANDIDATES)
    if (MediaRecorder.isTypeSupported(c)) return c
  return '' // let the browser use its default
}

function fmt(sec: number) {
  const m = Math.floor(sec / 60)
  return `${m}:${String(sec % 60).padStart(2, '0')}`
}

interface Clip {
  url: string
  mime: string
  sizeKb: number
  seconds: number
}

export function VoiceNotes(_props: { session: Session }) {
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')
  const [clip, setClip] = useState<Clip | null>(null)

  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAt = useRef(0)
  const timerRef = useRef<number | undefined>(undefined)

  // This device's audio capability readout (the thing to report per device).
  const diag = useMemo(() => {
    const a = typeof Audio !== 'undefined' ? new Audio() : null
    return {
      recorder: typeof MediaRecorder !== 'undefined',
      recordsAs: pickRecordMime() || '(browser default)',
      playsMp4: a ? a.canPlayType('audio/mp4') || 'no' : '?',
      playsWebmOpus: a ? a.canPlayType('audio/webm; codecs="opus"') || 'no' : '?',
    }
  }, [])

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
      recRef.current?.state === 'recording' && recRef.current.stop()
    }
  }, [])

  // Mic access is requested here, on the tap — never on page load.
  async function start() {
    setError('')
    setClip(null)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setError(
        'Microphone access was blocked. Allow the mic for this site in your browser settings, then try again.',
      )
      return
    }
    try {
      const mime = pickRecordMime()
      const rec = new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : undefined,
      )
      chunksRef.current = []
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        const type = rec.mimeType || mime || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type })
        setClip({
          url: URL.createObjectURL(blob),
          mime: blob.type,
          sizeKb: Math.round(blob.size / 1024),
          seconds: Math.max(
            1,
            Math.round((Date.now() - startedAt.current) / 1000),
          ),
        })
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
      setError(
        e instanceof Error
          ? `Recording couldn't start: ${e.message}`
          : "Recording couldn't start on this device.",
      )
    }
  }

  function stop() {
    recRef.current?.stop()
    if (timerRef.current) window.clearInterval(timerRef.current)
    setRecording(false)
  }

  return (
    <div className="rounded-2xl bg-paper ring-1 ring-ink/10 shadow-sm p-6 flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-stone-800">🎙 Voice Notes</h2>
      <p className="text-sm text-stone-500 -mt-2">
        Step 1 of this feature: recordings stay on this device for now — we’re
        testing that recording &amp; playback work on both your phones before
        sending is built.
      </p>

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
          <span className="tabular-nums text-2xl text-stone-700">
            {fmt(elapsed)}
          </span>
          <span className="text-sm text-stone-400">recording…</span>
        </div>
      ) : (
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={start}
            className="rounded-full w-16 h-16 bg-seal-500 text-cream text-2xl shadow-md hover:bg-seal-600"
            aria-label="start recording"
          >
            ●
          </button>
          <span className="text-sm text-stone-500">
            Tap to record a little hello
          </span>
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      {clip && (
        <div className="rounded-xl border border-stone-100 bg-white p-4 flex flex-col gap-2">
          <audio controls src={clip.url} className="w-full" />
          <p className="text-xs text-stone-400">
            {fmt(clip.seconds)} · {clip.sizeKb} KB · recorded as{' '}
            <span className="font-medium text-stone-600">{clip.mime}</span>
          </p>
        </div>
      )}

      {/* Device capability readout — report this line from each phone. */}
      <div
        data-testid="codec-diag"
        className="rounded-xl bg-stone-50 p-3 text-xs text-stone-500 leading-relaxed"
      >
        <span className="font-medium text-stone-600">This device:</span>{' '}
        records as <b>{diag.recordsAs}</b> · plays mp4:{' '}
        <b>{diag.playsMp4}</b> · plays webm/opus: <b>{diag.playsWebmOpus}</b>
      </div>
    </div>
  )
}
