import { useEffect, useState } from 'react'
import { labelForIdentity, type Identity } from '../lib/session'

// Home time zones for each of you. Change here if either of you moves.
const ZONES: Record<Identity, { tz: string; place: string }> = {
  me: { tz: 'America/Los_Angeles', place: 'California' },
  her: { tz: 'Europe/Copenhagen', place: 'Denmark' },
}

function timeIn(tz: string, now: Date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
  }).format(now)
}

function hourIn(tz: string, now: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      hour12: false,
    }).format(now),
  )
}

// Whole-hour difference between the two zones right now (DST-aware).
function hoursApart(now: Date): number {
  const at = (tz: string) =>
    new Date(now.toLocaleString('en-US', { timeZone: tz })).getTime()
  return Math.round((at(ZONES.her.tz) - at(ZONES.me.tz)) / 3_600_000)
}

function Clock({ id, now }: { id: Identity; now: Date }) {
  const { tz, place } = ZONES[id]
  const h = hourIn(tz, now)
  const icon = h >= 6 && h < 18 ? '☀️' : '🌙'
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      <span className="font-script text-lg leading-none text-ink">
        {labelForIdentity(id)}
      </span>
      <span className="tabular-nums font-medium text-stone-700">
        {timeIn(tz, now)}
      </span>
      <span className="text-sm" title={place}>
        {icon}
      </span>
    </span>
  )
}

export function TimeZoneClocks() {
  const [now, setNow] = useState(() => new Date())

  // Tick on the minute boundary so the clocks flip exactly on time.
  useEffect(() => {
    let interval: number | undefined
    const align = window.setTimeout(() => {
      setNow(new Date())
      interval = window.setInterval(() => setNow(new Date()), 60_000)
    }, (60 - new Date().getSeconds()) * 1000)
    return () => {
      window.clearTimeout(align)
      if (interval) window.clearInterval(interval)
    }
  }, [])

  const diff = hoursApart(now)

  return (
    <div className="max-w-4xl mx-auto px-4 pb-2 flex items-center justify-center gap-3 text-sm">
      <Clock id="me" now={now} />
      <span className="text-stone-400 text-xs">
        ✈ {Math.abs(diff)}h apart
      </span>
      <Clock id="her" now={now} />
    </div>
  )
}
