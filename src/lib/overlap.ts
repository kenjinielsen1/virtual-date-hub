// "Good time to call" interval math for two people in different time zones.
//
// Representation: every window is reduced to intervals on a 24-hour UTC clock,
// measured in MINUTES from 00:00 UTC, in [0, 1440]. A window whose UTC span
// crosses midnight is returned as TWO intervals split at 1440/0 — never as a
// single [start > end] range (that's the bug the design warns about). Each
// returned interval always has start < end, so intersection is plain linear
// interval math and cannot silently return empty across the wrap.
//
// All conversions are DST-correct per date via Intl.DateTimeFormat with a
// timeZone — no fixed offsets anywhere, because the US/EU DST dates differ and
// the real gap is 8h (not 9h) for a couple of weeks each spring and fall.

export interface UtcInterval {
  start: number // minutes from 00:00 UTC, inclusive
  end: number // minutes from 00:00 UTC, exclusive, always > start
}

const MIN = 60_000

// Offset (ms) of `timeZone` at instant `date`: (wall clock in zone) − UTC.
// e.g. Copenhagen in summer → +7200000 (+2h); LA in summer → −25200000 (−7h).
export function tzOffsetMs(timeZone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const p: Record<string, string> = {}
  for (const { type, value } of dtf.formatToParts(date)) p[type] = value
  const asUTC = Date.UTC(
    +p.year,
    +p.month - 1,
    +p.day,
    +p.hour,
    +p.minute,
    +p.second,
  )
  return asUTC - date.getTime()
}

// A wall-clock time (y/m/d h:m) in `timeZone` → absolute UTC instant (ms).
// Two-pass so it stays correct right at a DST transition.
export function zonedWallToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  timeZone: string,
): number {
  const naive = Date.UTC(y, mo - 1, d, h, mi)
  let offset = tzOffsetMs(timeZone, new Date(naive))
  let utc = naive - offset
  offset = tzOffsetMs(timeZone, new Date(utc))
  utc = naive - offset
  return utc
}

function parseHM(s: string): [number, number] {
  const [h, m] = s.split(':').map(Number)
  return [h, m || 0]
}

// Absolute [startMs, endMs] (end > start, span < 24h) → 1–2 intervals on the
// UTC 24-hour clock, split at midnight.
function splitToDayClock(startMs: number, endMs: number): UtcInterval[] {
  const durMin = Math.round((endMs - startMs) / MIN)
  const sMod = (((Math.round(startMs / MIN) % 1440) + 1440) % 1440)
  const eMod = sMod + durMin
  if (eMod <= 1440) return [{ start: sMod, end: eMod }]
  return [
    { start: sMod, end: 1440 },
    { start: 0, end: eMod - 1440 },
  ]
}

// A local [start, end] window on `onDate` in `timeZone` → 1–2 UTC-clock
// intervals. Handles windows that run past LOCAL midnight (end <= start) and
// windows that cross UTC midnight after conversion.
export function toUtcIntervals(
  localStart: string,
  localEnd: string,
  timeZone: string,
  onDate: Date,
): UtcInterval[] {
  const [y, mo, d] = localYmd(timeZone, onDate)
  const [sh, sm] = parseHM(localStart)
  const [eh, em] = parseHM(localEnd)
  const startUtc = zonedWallToUtc(y, mo, d, sh, sm, timeZone)
  const localWraps = eh * 60 + em <= sh * 60 + sm // runs past local midnight
  let endUtc: number
  if (localWraps) {
    const next = new Date(Date.UTC(y, mo - 1, d + 1)) // safe date arithmetic
    endUtc = zonedWallToUtc(
      next.getUTCFullYear(),
      next.getUTCMonth() + 1,
      next.getUTCDate(),
      eh,
      em,
      timeZone,
    )
  } else {
    endUtc = zonedWallToUtc(y, mo, d, eh, em, timeZone)
  }
  return splitToDayClock(startUtc, endUtc)
}

function mergeIntervals(ints: UtcInterval[]): UtcInterval[] {
  if (ints.length <= 1) return ints
  const sorted = [...ints].sort((a, b) => a.start - b.start)
  const out: UtcInterval[] = [{ ...sorted[0] }]
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1]
    if (sorted[i].start <= last.end)
      last.end = Math.max(last.end, sorted[i].end)
    else out.push({ ...sorted[i] })
  }
  return out
}

// Intersect two sets of UTC-clock intervals → the overlapping intervals.
export function intersect(a: UtcInterval[], b: UtcInterval[]): UtcInterval[] {
  const out: UtcInterval[] = []
  for (const x of a)
    for (const y of b) {
      const s = Math.max(x.start, y.start)
      const e = Math.min(x.end, y.end)
      if (e > s) out.push({ start: s, end: e })
    }
  return mergeIntervals(out)
}

export function totalMinutes(ints: UtcInterval[]): number {
  return ints.reduce((sum, i) => sum + (i.end - i.start), 0)
}

// Format an absolute UTC instant in two zones: "3:00 PM / 12:00 AM".
export function formatInBothZones(
  utcInstant: number | Date,
  tzA: string,
  tzB: string,
): string {
  const dt = typeof utcInstant === 'number' ? new Date(utcInstant) : utcInstant
  const f = (tz: string) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: '2-digit',
    }).format(dt)
  return `${f(tzA)} / ${f(tzB)}`
}

// Whole-hour gap between two zones at an instant (DST-correct). Copenhagen −
// Los_Angeles = 9h most of the year, 8h during the spring/fall DST-mismatch.
export function zoneGapHours(tzA: string, tzB: string, at: Date): number {
  return (tzOffsetMs(tzB, at) - tzOffsetMs(tzA, at)) / 3_600_000
}

// Map a UTC-clock minute-of-day back to an absolute instant on the UTC day that
// contains `reference` (used later by the UI to label overlap boundaries).
export function utcMinuteToInstant(minuteOfDay: number, reference: Date): Date {
  const base = Date.UTC(
    reference.getUTCFullYear(),
    reference.getUTCMonth(),
    reference.getUTCDate(),
  )
  return new Date(base + minuteOfDay * MIN)
}

// ---- Axis helpers (for the widget) ---------------------------------------
// Everything above works on a UTC 24h clock. The widget draws on the VIEWER's
// local 24h day, so we shift UTC-clock intervals by the viewer's offset.

export function zoneOffsetMinutes(tz: string, at: Date): number {
  return Math.round(tzOffsetMs(tz, at) / MIN)
}

// Shift a set of UTC-clock intervals by `deltaMin` and re-split at midnight, so
// they read on a local 24h axis (0 = local midnight). Public for the widget.
export function shiftIntervals(
  ints: UtcInterval[],
  deltaMin: number,
): UtcInterval[] {
  const out: UtcInterval[] = []
  for (const { start, end } of ints) {
    const len = end - start
    const s = (((start + deltaMin) % 1440) + 1440) % 1440
    const e = s + len
    if (e <= 1440) out.push({ start: s, end: e })
    else {
      out.push({ start: s, end: 1440 })
      out.push({ start: 0, end: e - 1440 })
    }
  }
  return mergeIntervals(out)
}

// Minutes since local midnight, right now, in `tz`.
export function localNowMinutes(tz: string): number {
  const p: Record<string, string> = {}
  for (const { type, value } of new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date())) {
    p[type] = value
  }
  return +p.hour * 60 + +p.minute
}

// Absolute instant (ms) of local midnight in `tz` on the day of `reference`.
export function localMidnightInstant(tz: string, reference: Date): number {
  const [y, mo, d] = localYmd(tz, reference)
  return zonedWallToUtc(y, mo, d, 0, 0, tz)
}

export function localYmd(tz: string, onDate: Date): [number, number, number] {
  const p: Record<string, string> = {}
  for (const { type, value } of new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(onDate)) {
    p[type] = value
  }
  return [+p.year, +p.month, +p.day]
}
// ---- Per-day (absolute-time) helpers -------------------------------------
// For per-weekday schedules, a local window is anchored to a SPECIFIC calendar
// date. These return absolute UTC instants (ms), so overlap is plain linear
// math and a person's "which weekday" is resolved per date (correct across the
// date line, where it can be a different weekday for each person).

export interface AbsInterval {
  start: number // epoch ms
  end: number // epoch ms, > start
}

// A local [start,end] window on a specific local date (y/mo/d) in `tz` →
// absolute [start,end] ms (handles a window that runs past local midnight).
export function absoluteInterval(
  localStart: string,
  localEnd: string,
  tz: string,
  y: number,
  mo: number,
  d: number,
): AbsInterval {
  const [sh, sm] = localStart.split(':').map(Number)
  const [eh, em] = localEnd.split(':').map(Number)
  const start = zonedWallToUtc(y, mo, d, sh, sm || 0, tz)
  const wraps = eh * 60 + (em || 0) <= sh * 60 + (sm || 0)
  let end: number
  if (wraps) {
    const nx = new Date(Date.UTC(y, mo - 1, d + 1))
    end = zonedWallToUtc(
      nx.getUTCFullYear(),
      nx.getUTCMonth() + 1,
      nx.getUTCDate(),
      eh,
      em || 0,
      tz,
    )
  } else {
    end = zonedWallToUtc(y, mo, d, eh, em || 0, tz)
  }
  return { start, end }
}

// The local calendar dates (with weekday 0=Sun..6=Sat) that touch the window
// [startMs, endMs] in `tz` — including the day before, to catch a window that
// began the previous local day and spills into the window.
export function localDatesInWindow(
  tz: string,
  startMs: number,
  endMs: number,
): { y: number; mo: number; d: number; weekday: number }[] {
  const out: { y: number; mo: number; d: number; weekday: number }[] = []
  const seen = new Set<string>()
  for (let cursor = startMs - 86_400_000; cursor <= endMs + 1; cursor += 86_400_000) {
    const [y, mo, d] = localYmd(tz, new Date(cursor))
    const key = `${y}-${mo}-${d}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ y, mo, d, weekday: new Date(Date.UTC(y, mo - 1, d)).getUTCDay() })
  }
  return out
}

export function intersectAbsolute(a: AbsInterval[], b: AbsInterval[]): AbsInterval[] {
  const out: AbsInterval[] = []
  for (const x of a)
    for (const y of b) {
      const s = Math.max(x.start, y.start)
      const e = Math.min(x.end, y.end)
      if (e > s) out.push({ start: s, end: e })
    }
  return out.sort((p, q) => p.start - q.start)
}

// Merge overlapping/adjacent absolute intervals.
export function mergeAbsolute(ints: AbsInterval[]): AbsInterval[] {
  if (ints.length <= 1) return ints
  const s = [...ints].sort((a, b) => a.start - b.start)
  const out: AbsInterval[] = [{ ...s[0] }]
  for (let i = 1; i < s.length; i++) {
    const last = out[out.length - 1]
    if (s[i].start <= last.end) last.end = Math.max(last.end, s[i].end)
    else out.push({ ...s[i] })
  }
  return out
}
