import { describe, it, expect } from 'vitest'
import {
  toUtcIntervals,
  intersect,
  formatInBothZones,
  zoneGapHours,
  totalMinutes,
  zonedWallToUtc,
  absoluteInterval,
  localDatesInWindow,
} from './overlap'

const LA = 'America/Los_Angeles'
const CPH = 'Europe/Copenhagen'
// A summer date (both on DST) and dates chosen to probe the DST mismatch.
const SUMMER = new Date('2026-07-09T12:00:00Z')

describe('toUtcIntervals — UTC-midnight wrapping', () => {
  it('wraps: LA 07:00–23:00 (summer) crosses UTC midnight → two intervals', () => {
    // 07:00 PDT = 14:00 UTC (840). 23:00 PDT = 06:00 UTC next day (360).
    const iv = toUtcIntervals('07:00', '23:00', LA, SUMMER)
    expect(iv).toEqual([
      { start: 840, end: 1440 }, // 14:00 → 24:00 UTC
      { start: 0, end: 360 }, // 00:00 → 06:00 UTC
    ])
    expect(totalMinutes(iv)).toBe(16 * 60) // still a 16-hour window
  })

  it('does NOT wrap: Copenhagen 07:00–23:00 (summer) stays one interval', () => {
    // 07:00 CEST = 05:00 UTC (300). 23:00 CEST = 21:00 UTC (1260).
    const iv = toUtcIntervals('07:00', '23:00', CPH, SUMMER)
    expect(iv).toEqual([{ start: 300, end: 1260 }])
  })

  it('handles a window that runs past LOCAL midnight (22:00–06:00)', () => {
    // CPH 22:00 CEST = 20:00 UTC (1200); 06:00 next day CEST = 04:00 UTC (240).
    const iv = toUtcIntervals('22:00', '06:00', CPH, SUMMER)
    expect(iv).toEqual([
      { start: 1200, end: 1440 },
      { start: 0, end: 240 },
    ])
    expect(totalMinutes(iv)).toBe(8 * 60)
  })
})

describe('intersect', () => {
  it('zero overlap → empty', () => {
    // LA 09:00–11:00 = 16:00–18:00 UTC [960,1080];
    // CPH 09:00–11:00 = 07:00–09:00 UTC [420,540]. No overlap.
    const a = toUtcIntervals('09:00', '11:00', LA, SUMMER)
    const b = toUtcIntervals('09:00', '11:00', CPH, SUMMER)
    expect(intersect(a, b)).toEqual([])
    expect(totalMinutes(intersect(a, b))).toBe(0)
  })

  it('overlap across the UTC date boundary', () => {
    // LA awake 07:00–23:00 wraps → [840,1440]+[0,360].
    // CPH early 06:00–08:00 = 04:00–06:00 UTC = [240,360].
    // Overlap lives in LA's post-midnight interval → [240,360].
    const la = toUtcIntervals('07:00', '23:00', LA, SUMMER)
    const cph = toUtcIntervals('06:00', '08:00', CPH, SUMMER)
    expect(intersect(la, cph)).toEqual([{ start: 240, end: 360 }])
  })

  it('a realistic "good time to call": both preferred evenings', () => {
    // LA prefers 18:00–22:00 = 01:00–05:00 UTC next day → [60,300].
    // CPH prefers 20:00–23:00 = 18:00–21:00 UTC → [1080,1260].
    // These do NOT overlap (the honest answer for a 9h gap + evening bias).
    const la = toUtcIntervals('18:00', '22:00', LA, SUMMER)
    const cph = toUtcIntervals('20:00', '23:00', CPH, SUMMER)
    expect(intersect(la, cph)).toEqual([])

    // But LA morning 08:00–10:00 (15:00–17:00 UTC = [900,1020]) overlaps
    // CPH afternoon 16:00–18:00 (14:00–16:00 UTC = [840,960]) → [900,960].
    const laAm = toUtcIntervals('08:00', '10:00', LA, SUMMER)
    const cphPm = toUtcIntervals('16:00', '18:00', CPH, SUMMER)
    expect(intersect(laAm, cphPm)).toEqual([{ start: 900, end: 960 }])
  })
})

describe('DST correctness — the 8h vs 9h gap', () => {
  it('summer (both on DST): 9h', () => {
    expect(zoneGapHours(LA, CPH, new Date('2026-07-09T12:00:00Z'))).toBe(9)
  })
  it('deep winter (both standard): 9h', () => {
    expect(zoneGapHours(LA, CPH, new Date('2026-01-15T12:00:00Z'))).toBe(9)
  })
  it('spring gap — US sprang (Mar 8) but EU has not (Mar 29): 8h, not 9h', () => {
    expect(zoneGapHours(LA, CPH, new Date('2026-03-15T12:00:00Z'))).toBe(8)
  })
  it('fall gap — EU fell back (Oct 25) but US has not (Nov 1): 8h, not 9h', () => {
    expect(zoneGapHours(LA, CPH, new Date('2026-10-28T12:00:00Z'))).toBe(8)
  })

  it('the DST-gap actually shifts the computed overlap by an hour', () => {
    // Same clock windows, two different dates. The overlap must move because
    // the real offset gap is 9h in summer and 8h in the spring mismatch.
    const laWin = ['08:00', '10:00'] as const
    const cphWin = ['16:00', '18:00'] as const
    const summer = intersect(
      toUtcIntervals(...laWin, LA, new Date('2026-07-09T12:00:00Z')),
      toUtcIntervals(...cphWin, CPH, new Date('2026-07-09T12:00:00Z')),
    )
    const springGap = intersect(
      toUtcIntervals(...laWin, LA, new Date('2026-03-15T12:00:00Z')),
      toUtcIntervals(...cphWin, CPH, new Date('2026-03-15T12:00:00Z')),
    )
    // Summer (9h gap): CPH afternoon lands an hour earlier in UTC → only a
    // 1-hour overlap [900,960]. In the spring 8h-gap window the two windows
    // align to the same UTC hours → a full 2-hour overlap [900,1020]. Same
    // clock inputs, materially different answer — exactly why fixed offsets
    // would be wrong here.
    expect(summer).toEqual([{ start: 900, end: 960 }])
    expect(springGap).toEqual([{ start: 900, end: 1020 }])
    expect(totalMinutes(summer)).toBe(60)
    expect(totalMinutes(springGap)).toBe(120)
  })
})

describe('per-day (absolute) helpers', () => {
  it('absoluteInterval anchors to a specific date, DST-correct', () => {
    // 18:00–22:00 CPH on 2026-07-09 (CEST +2) = 16:00–20:00 UTC.
    const iv = absoluteInterval('18:00', '22:00', CPH, 2026, 7, 9)
    expect(new Date(iv.start).toISOString()).toBe('2026-07-09T16:00:00.000Z')
    expect(new Date(iv.end).toISOString()).toBe('2026-07-09T20:00:00.000Z')
  })

  it('a window past local midnight ends on the next date', () => {
    const iv = absoluteInterval('22:00', '02:00', CPH, 2026, 7, 9)
    expect(new Date(iv.start).toISOString()).toBe('2026-07-09T20:00:00.000Z')
    expect(new Date(iv.end).toISOString()).toBe('2026-07-10T00:00:00.000Z')
  })

  it('localDatesInWindow spans the local days a UTC window touches', () => {
    // Viewer LA local day for 2026-07-09: midnight LA = 07:00 UTC → +24h.
    const midnight = zonedWallToUtc(2026, 7, 9, 0, 0, LA)
    const dates = localDatesInWindow(CPH, midnight, midnight + 86_400_000)
    // LA's 2026-07-09 day is CPH 09:00 Thu → 09:00 Fri, so it touches CPH
    // Jul 9 (Thu, weekday 4) and Jul 10 (Fri, weekday 5), plus the day-before.
    const wd = dates.map((x) => x.weekday)
    expect(wd).toContain(4) // Thursday
    expect(wd).toContain(5) // Friday
  })

  it('PER-DAY correctness at the date line: her schedule differs Thu vs Fri', () => {
    // Viewer = LA, showing LA 2026-07-09 (a Thursday in LA).
    const axisStart = zonedWallToUtc(2026, 7, 9, 0, 0, LA)
    const axisEnd = axisStart + 86_400_000
    // Partner in CPH: Thursday she prefers 09:00–11:00, Friday 20:00–22:00.
    const prefByDay: Record<number, [string, string]> = {
      4: ['09:00', '11:00'], // Thu
      5: ['20:00', '22:00'], // Fri
    }
    const dates = localDatesInWindow(CPH, axisStart, axisEnd)
    const herPref = dates
      .filter((x) => prefByDay[x.weekday])
      .map((x) => {
        const [s, e] = prefByDay[x.weekday]
        const iv = absoluteInterval(s, e, CPH, x.y, x.mo, x.d)
        // clip to the axis day
        return {
          start: Math.max(iv.start, axisStart),
          end: Math.min(iv.end, axisEnd),
        }
      })
      .filter((iv) => iv.end > iv.start)
    // Thu 09:00 CPH = 07:00 UTC (inside the LA day window) → present.
    // Fri 20:00 CPH = 18:00 UTC = next day, OUTSIDE this LA window → absent.
    // So exactly the Thursday window should show, proving we didn't wrongly
    // apply one day's schedule across the whole axis.
    expect(herPref.length).toBe(1)
    expect(new Date(herPref[0].start).toISOString()).toBe(
      '2026-07-09T07:00:00.000Z',
    )
  })
})

describe('formatInBothZones', () => {
  it('labels a single instant in both zones', () => {
    // 22:00 UTC on the summer date → 3:00 PM PDT / 12:00 AM CEST (next day).
    const instant = zonedWallToUtc(2026, 7, 9, 22, 0, 'UTC')
    expect(formatInBothZones(instant, LA, CPH)).toBe('3:00 PM / 12:00 AM')
  })
})
