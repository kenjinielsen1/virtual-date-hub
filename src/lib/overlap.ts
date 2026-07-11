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

// The local calendar date (y/m/d) that instant `onDate` falls on in `timeZone`.
function localYmd(onDate: Date, timeZone: string): [number, number, number] {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const p: Record<string, string> = {}
  for (const { type, value } of dtf.formatToParts(onDate)) p[type] = value
  return [+p.year, +p.month, +p.day]
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
  const [y, mo, d] = localYmd(onDate, timeZone)
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
  const [y, mo, d] = localYmdExport(reference, tz)
  return zonedWallToUtc(y, mo, d, 0, 0, tz)
}

function localYmdExport(onDate: Date, tz: string): [number, number, number] {
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
