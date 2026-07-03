import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useRoomChannel } from '../lib/RoomChannel'
import type { Session } from '../lib/session'
import { ResetButton } from './ResetButton'

function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}

interface Remaining {
  days: number
  hours: number
  minutes: number
  seconds: number
  reached: boolean
}

function computeRemaining(dateStr: string): Remaining {
  const target = new Date(`${dateStr}T00:00:00`).getTime()
  const diff = target - Date.now()
  if (diff <= 0)
    return { days: 0, hours: 0, minutes: 0, seconds: 0, reached: true }
  const s = Math.floor(diff / 1000)
  return {
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
    reached: false,
  }
}

export function VisitCountdown({ session }: { session: Session }) {
  const { broadcast, on } = useRoomChannel()
  const [visitDate, setVisitDate] = useState<string | null>(null)
  const [draft, setDraft] = useState(todayLocal())
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    supabase
      .from('room_state')
      .select('visit_date')
      .eq('room_id', session.roomCode)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.visit_date) setVisitDate(data.visit_date as string)
      })
  }, [session.roomCode])

  useEffect(() => {
    const offSet = on('visit:set', (p) => setVisitDate((p as { date: string }).date))
    const offClear = on('visit:clear', () => setVisitDate(null))
    return () => {
      offSet()
      offClear()
    }
  }, [on])

  // Tick every second while a date is set.
  useEffect(() => {
    if (!visitDate) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [visitDate])

  const remaining = useMemo(
    () => (visitDate ? computeRemaining(visitDate) : null),
    // now drives the recompute
    [visitDate, now],
  )

  function setDate() {
    setVisitDate(draft)
    broadcast('visit:set', { date: draft })
    supabase
      .from('room_state')
      .upsert({ room_id: session.roomCode, visit_date: draft })
      .then(() => {})
  }

  function clearDate() {
    setVisitDate(null)
    broadcast('visit:clear', {})
    supabase
      .from('room_state')
      .upsert({ room_id: session.roomCode, visit_date: null })
      .then(() => {})
  }

  const prettyDate = visitDate
    ? new Date(`${visitDate}T00:00:00`).toLocaleDateString(undefined, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : ''

  return (
    <div className="rounded-2xl bg-paper ring-1 ring-ink/10 shadow-sm p-8 flex flex-col items-center gap-5 text-center">
      <h2 className="text-lg font-semibold text-stone-800">
        ✈️ Countdown to seeing each other
      </h2>

      {!visitDate ? (
        <div className="flex flex-col items-center gap-3">
          <p className="text-stone-500">
            When’s your next in-person visit? Set the date and watch it count
            down together.
          </p>
          <div className="flex gap-2">
            <input
              type="date"
              value={draft}
              min={todayLocal()}
              onChange={(e) => setDraft(e.target.value)}
              className="rounded-xl border border-stone-200 px-3 py-2 outline-none focus:ring-2 focus:ring-seal-300"
            />
            <button
              type="button"
              onClick={setDate}
              className="rounded-xl bg-seal-500 text-white px-5 py-2 font-medium hover:bg-seal-600"
            >
              Set date
            </button>
          </div>
        </div>
      ) : remaining?.reached ? (
        <Celebration date={prettyDate} onClear={clearDate} />
      ) : (
        <>
          <p className="text-stone-500">
            Together again on <span className="font-semibold">{prettyDate}</span>
          </p>
          <div className="flex gap-3 sm:gap-5">
            <Unit value={remaining!.days} label="days" />
            <Unit value={remaining!.hours} label="hours" />
            <Unit value={remaining!.minutes} label="min" />
            <Unit value={remaining!.seconds} label="sec" />
          </div>
          <ResetButton
            label="Change date"
            confirm="Clear the visit countdown for both of you?"
            onReset={clearDate}
          />
        </>
      )}
    </div>
  )
}

function Unit({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <div className="rounded-2xl bg-gradient-to-br from-seal-500 to-gold-500 text-white text-3xl sm:text-5xl font-bold tabular-nums w-16 sm:w-24 py-3 shadow-lg">
        {String(value).padStart(2, '0')}
      </div>
      <div className="text-xs text-stone-400 mt-1 uppercase tracking-wide">
        {label}
      </div>
    </div>
  )
}

function Celebration({ date, onClear }: { date: string; onClear: () => void }) {
  // A little confetti burst.
  const pieces = ['🎉', '💕', '✨', '🥰', '🎊', '💖']
  return (
    <>
      {Array.from({ length: 24 }).map((_, i) => (
        <span
          key={i}
          className="vdh-confetti"
          style={{
            left: `${(i * 4.3) % 100}%`,
            animationDuration: `${3 + (i % 5)}s`,
            animationDelay: `${(i % 6) * 0.4}s`,
          }}
        >
          {pieces[i % pieces.length]}
        </span>
      ))}
      <div className="text-5xl">🥳</div>
      <p className="text-2xl font-bold text-seal-600">It’s reunion day!</p>
      <p className="text-stone-500">
        {date} is here — go be together 💕
      </p>
      <ResetButton
        label="Set a new date"
        confirm="Clear this countdown and set a new visit date?"
        onReset={onClear}
      />
    </>
  )
}
