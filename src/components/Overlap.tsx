import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useRoomChannel } from '../lib/RoomChannel'
import { labelForIdentity, type Identity, type Session } from '../lib/session'
import {
  absoluteInterval,
  localDatesInWindow,
  intersectAbsolute,
  mergeAbsolute,
  localMidnightInstant,
  formatInBothZones,
  type AbsInterval,
  type UtcInterval,
} from '../lib/overlap'

// Detected device zone — right for where you ARE, which may not be where you
// live (Kenji travels CA ↔ DK), so it's a default you can override, never a
// silent overwrite of a saved value.
const DETECTED = Intl.DateTimeFormat().resolvedOptions().timeZone

// A curated shortlist; the detected + any saved zone are always injected too.
const COMMON_ZONES = [
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Sao_Paulo',
  'UTC',
  'Europe/London',
  'Europe/Copenhagen',
  'Europe/Berlin',
  'Europe/Paris',
  'Europe/Athens',
  'Africa/Cairo',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
]

function nowIn(tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date())
  } catch {
    return ''
  }
}

type PrefByDay = Record<string, [string, string]> // "0".."6" → [start,end]

interface AvailRow {
  timezone: string
  awake_start: string
  awake_end: string
  preferred_start: string | null
  preferred_end: string | null
  preferred_by_day: PrefByDay | null
}

const pct = (min: number) => `${(min / 1440) * 100}%`

// Display order Mon…Sun (weekday index 0=Sun).
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]
const DAY_NAME: Record<number, string> = {
  0: 'Sun',
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
}

interface DayPref {
  on: boolean
  start: string
  end: string
}
const emptyDays = (): DayPref[] =>
  Array.from({ length: 7 }, () => ({ on: false, start: '18:00', end: '22:00' }))

// The preferred window (local HH:MM) for a given weekday on a row, or null.
export function prefWindowForWeekday(
  row: AvailRow,
  weekday: number,
): [string, string] | null {
  if (row.preferred_by_day) {
    const w = row.preferred_by_day[String(weekday)]
    return w ? [w[0].slice(0, 5), w[1].slice(0, 5)] : null
  }
  if (row.preferred_start && row.preferred_end)
    return [row.preferred_start.slice(0, 5), row.preferred_end.slice(0, 5)]
  return null
}

// hh:mm:ss (from Postgres time) → hh:mm (for <input type=time>)
const hm = (t: string | null | undefined) => (t ? t.slice(0, 5) : '')

export function Overlap({ session }: { session: Session }) {
  const { broadcast, on } = useRoomChannel()
  const partnerId: Identity = session.identity === 'me' ? 'her' : 'me'

  const [tz, setTz] = useState(DETECTED)
  const [awakeStart, setAwakeStart] = useState('07:00')
  const [awakeEnd, setAwakeEnd] = useState('23:00')
  const [prefStart, setPrefStart] = useState('')
  const [prefEnd, setPrefEnd] = useState('')
  const [perDay, setPerDay] = useState(false)
  const [days, setDays] = useState<DayPref[]>(emptyDays)

  const [savedTz, setSavedTz] = useState<string | null>(null)
  const [meRow, setMeRow] = useState<AvailRow | null>(null)
  const [partnerRow, setPartnerRow] = useState<AvailRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [mismatch, setMismatch] = useState(false)

  async function load() {
    const { data } = await supabase
      .from('availability')
      .select('*')
      .eq('room_id', session.roomCode)
    setLoading(false)
    if (!data) return
    const mine = data.find((r) => r.identity === session.identity) as
      | (AvailRow & { identity: string })
      | undefined
    const theirs = data.find((r) => r.identity === partnerId) as
      | (AvailRow & { identity: string })
      | undefined
    setPartnerRow(theirs ?? null)
    setMeRow(mine ?? null)
    if (mine) {
      setTz(mine.timezone)
      setSavedTz(mine.timezone)
      setAwakeStart(hm(mine.awake_start))
      setAwakeEnd(hm(mine.awake_end))
      setPrefStart(hm(mine.preferred_start))
      setPrefEnd(hm(mine.preferred_end))
      if (mine.preferred_by_day) {
        setPerDay(true)
        const d = emptyDays()
        for (const [wd, win] of Object.entries(mine.preferred_by_day)) {
          d[+wd] = { on: true, start: hm(win[0]), end: hm(win[1]) }
        }
        setDays(d)
      } else {
        setPerDay(false)
      }
      // Rule 3: if the device zone now differs from the saved one, PROMPT.
      if (mine.timezone !== DETECTED) setMismatch(true)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.roomCode])

  // Live: partner edited their availability.
  useEffect(() => {
    return on('availability:update', () => load())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on])

  const zoneOptions = useMemo(() => {
    const set = new Set([DETECTED, tz, savedTz ?? '', ...COMMON_ZONES])
    set.delete('')
    return [...set]
  }, [tz, savedTz])

  async function save() {
    if (!awakeStart || !awakeEnd) {
      setMsg('Please set your awake hours.')
      return
    }
    if (!perDay && ((prefStart && !prefEnd) || (!prefStart && prefEnd))) {
      setMsg('Set both preferred times, or leave both blank.')
      return
    }
    let prefByDay: PrefByDay | null = null
    if (perDay) {
      prefByDay = {}
      for (let wd = 0; wd < 7; wd++) {
        const d = days[wd]
        if (d.on && d.start && d.end) prefByDay[String(wd)] = [d.start, d.end]
      }
    }
    setSaving(true)
    setMsg('')
    const { error } = await supabase.from('availability').upsert(
      {
        room_id: session.roomCode,
        identity: session.identity,
        timezone: tz,
        awake_start: awakeStart,
        awake_end: awakeEnd,
        preferred_start: perDay ? null : prefStart || null,
        preferred_end: perDay ? null : prefEnd || null,
        preferred_by_day: prefByDay,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'room_id,identity' },
    )
    setSaving(false)
    if (error) {
      setMsg(`Couldn't save: ${error.message}`)
      return
    }
    // Refresh our own row so the bar reflects the change immediately (save()
    // writes to the DB but doesn't touch meRow); the partner reloads via the
    // broadcast below. Do this BEFORE clearing the mismatch prompt, since
    // load() re-evaluates it and we don't want to re-warn on a deliberate save.
    await load()
    setSavedTz(tz)
    setMismatch(false)
    broadcast('availability:update', { identity: session.identity })
    setMsg('Saved ♡')
    window.setTimeout(() => setMsg(''), 3000)
  }

  const fieldLabel = 'block text-sm font-medium text-stone-600 mb-1'
  const input =
    'rounded-xl border border-stone-200 px-3 py-2 outline-none focus:ring-2 focus:ring-seal-300'

  return (
    <div className="flex flex-col gap-4">
      {meRow && partnerRow && (
        <OverlapBar
          viewer={session.identity}
          me={meRow}
          her={partnerRow}
        />
      )}
      <div className="rounded-2xl bg-paper ring-1 ring-ink/10 shadow-sm p-6 flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-stone-800">
          🕰 Good time to call
        </h2>
        <p className="text-sm text-stone-500 -mt-2">
          Set your hours so we can find when you’re both around. (The overlap bar
          comes next.)
        </p>

        <div className="rounded-xl bg-stone-50 p-3 text-sm text-stone-600">
          Right now — {labelForIdentity(session.identity)}:{' '}
          <b>{nowIn(tz)}</b> ({tz.split('/').pop()?.replace('_', ' ')})
          {partnerRow && (
            <>
              {' · '}
              {labelForIdentity(partnerId)}: <b>{nowIn(partnerRow.timezone)}</b>{' '}
              ({partnerRow.timezone.split('/').pop()?.replace('_', ' ')})
            </>
          )}
        </div>

        {mismatch && (
          <div className="rounded-xl bg-gold-50 border border-gold-200 p-3 text-sm text-stone-700 flex items-center justify-between gap-3">
            <span>
              Your device says <b>{DETECTED}</b>, but your saved zone is{' '}
              <b>{savedTz}</b>. Traveling?
            </span>
            <span className="flex gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setTz(DETECTED)
                  setMismatch(false)
                }}
                className="rounded-lg bg-seal-500 text-white px-2.5 py-1 text-xs font-medium"
              >
                Use {DETECTED.split('/').pop()?.replace('_', ' ')}
              </button>
              <button
                type="button"
                onClick={() => setMismatch(false)}
                className="rounded-lg bg-stone-200 text-stone-600 px-2.5 py-1 text-xs"
              >
                Keep saved
              </button>
            </span>
          </div>
        )}

        {loading ? (
          <p className="text-stone-400 text-sm">Loading…</p>
        ) : (
          <>
            <div>
              <label className={fieldLabel}>Your time zone</label>
              <select
                value={tz}
                onChange={(e) => setTz(e.target.value)}
                className={input + ' w-full'}
              >
                {zoneOptions.map((z) => (
                  <option key={z} value={z}>
                    {z} — {nowIn(z)}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={fieldLabel}>Awake from</label>
                <input
                  type="time"
                  value={awakeStart}
                  onChange={(e) => setAwakeStart(e.target.value)}
                  className={input + ' w-full'}
                />
              </div>
              <div>
                <label className={fieldLabel}>Awake until</label>
                <input
                  type="time"
                  value={awakeEnd}
                  onChange={(e) => setAwakeEnd(e.target.value)}
                  className={input + ' w-full'}
                />
              </div>
            </div>

            <div className="border-t border-stone-100 pt-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-stone-600">
                  Preferred time to talk{' '}
                  <span className="text-stone-400">(optional)</span>
                </span>
                <label className="flex items-center gap-1.5 text-xs text-stone-500 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={perDay}
                    onChange={(e) => setPerDay(e.target.checked)}
                  />
                  Different by day
                </label>
              </div>

              {!perDay ? (
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="time"
                    value={prefStart}
                    onChange={(e) => setPrefStart(e.target.value)}
                    className={input + ' w-full'}
                    aria-label="preferred from"
                  />
                  <input
                    type="time"
                    value={prefEnd}
                    onChange={(e) => setPrefEnd(e.target.value)}
                    className={input + ' w-full'}
                    aria-label="preferred until"
                  />
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {DAY_ORDER.map((wd) => {
                    const d = days[wd]
                    return (
                      <div key={wd} className="flex items-center gap-2">
                        <label className="flex items-center gap-1.5 w-16 shrink-0 text-sm text-stone-600">
                          <input
                            type="checkbox"
                            checked={d.on}
                            onChange={(e) =>
                              setDays((prev) => {
                                const n = [...prev]
                                n[wd] = { ...n[wd], on: e.target.checked }
                                return n
                              })
                            }
                          />
                          {DAY_NAME[wd]}
                        </label>
                        {d.on ? (
                          <>
                            <input
                              type="time"
                              value={d.start}
                              onChange={(e) =>
                                setDays((prev) => {
                                  const n = [...prev]
                                  n[wd] = { ...n[wd], start: e.target.value }
                                  return n
                                })
                              }
                              className={input + ' flex-1 text-sm py-1.5'}
                            />
                            <span className="text-stone-400 text-xs">to</span>
                            <input
                              type="time"
                              value={d.end}
                              onChange={(e) =>
                                setDays((prev) => {
                                  const n = [...prev]
                                  n[wd] = { ...n[wd], end: e.target.value }
                                  return n
                                })
                              }
                              className={input + ' flex-1 text-sm py-1.5'}
                            />
                          </>
                        ) : (
                          <span className="text-xs text-stone-400 flex-1">
                            not available
                          </span>
                        )}
                      </div>
                    )
                  })}
                  <button
                    type="button"
                    onClick={() =>
                      setDays((prev) => {
                        const first = prev[DAY_ORDER[0]]
                        return prev.map(() => ({ ...first }))
                      })
                    }
                    className="self-start text-xs text-seal-600 hover:text-seal-700 mt-1"
                  >
                    Copy {DAY_NAME[DAY_ORDER[0]]} to every day
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="rounded-xl bg-seal-500 text-white px-5 py-2 font-medium hover:bg-seal-600 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save my hours'}
              </button>
              {msg && (
                <span
                  className={`text-sm ${msg.startsWith('Saved') ? 'text-green-600' : 'text-red-500'}`}
                >
                  {msg}
                </span>
              )}
            </div>

            <p className="text-xs text-stone-400">
              {partnerRow
                ? `${labelForIdentity(partnerId)} has set their hours too ✓`
                : `${labelForIdentity(partnerId)} hasn't set their hours yet.`}
            </p>
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The 24-hour overlap bar, drawn on the VIEWER's local day (0 = your midnight).
// Both people's UTC-clock windows are shifted onto that axis; overlaps are
// computed timezone-neutrally (in UTC) then shifted for drawing.
// ---------------------------------------------------------------------------
function OverlapBar({
  viewer,
  me,
  her,
}: {
  viewer: Identity
  me: AvailRow
  her: AvailRow
}) {
  // Re-render each minute so the "now" marker moves and the day can roll over.
  const [nowTick, setNowTick] = useState(Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  const data = useMemo(() => {
    const now = new Date(nowTick)
    const viewerRow = me // the current user's own row is always "me" identity
    const viewerTz = viewerRow.timezone
    const hm = (t: string) => t.slice(0, 5)

    // The axis is the VIEWER's local 24h day: [axisStart, axisEnd] in epoch-ms.
    const axisStart = localMidnightInstant(viewerTz, now)
    const axisEnd = axisStart + 86_400_000
    const dates = localDatesInWindow(viewerTz, axisStart, axisEnd)

    // Clip an absolute interval to the axis and convert to axis-minutes [0,1440].
    const toAxisMin = (ints: AbsInterval[]): UtcInterval[] =>
      ints
        .map((iv) => ({
          start: Math.max(iv.start, axisStart),
          end: Math.min(iv.end, axisEnd),
        }))
        .filter((iv) => iv.end > iv.start)
        .map((iv) => ({
          start: (iv.start - axisStart) / 60_000,
          end: (iv.end - axisStart) / 60_000,
        }))

    // A person's awake window is a single daily schedule; build it on each local
    // date that touches the axis (so it's correct across the date line).
    const awakeAbs = (r: AvailRow): AbsInterval[] =>
      mergeAbsolute(
        dates
          .map((dt) =>
            absoluteInterval(
              hm(r.awake_start),
              hm(r.awake_end),
              r.timezone,
              dt.y,
              dt.mo,
              dt.d,
            ),
          )
          .filter((iv) => iv.end > axisStart && iv.start < axisEnd),
      )

    // Preferred windows can differ per weekday — resolve each date's own window.
    const prefAbs = (r: AvailRow): AbsInterval[] =>
      mergeAbsolute(
        dates
          .map((dt) => {
            const win = prefWindowForWeekday(r, dt.weekday)
            if (!win) return null
            return absoluteInterval(win[0], win[1], r.timezone, dt.y, dt.mo, dt.d)
          })
          .filter((iv): iv is AbsInterval => !!iv)
          .filter((iv) => iv.end > axisStart && iv.start < axisEnd),
      )

    const meAwakeA = awakeAbs(me)
    const herAwakeA = awakeAbs(her)
    const mePrefA = prefAbs(me)
    const herPrefA = prefAbs(her)

    const awakeOverlapA = mergeAbsolute(intersectAbsolute(meAwakeA, herAwakeA))
    const prefOverlapA =
      mePrefA.length && herPrefA.length
        ? mergeAbsolute(intersectAbsolute(mePrefA, herPrefA))
        : []

    const labelAxis = (min: number) =>
      formatInBothZones(axisStart + min * 60_000, viewerTz, her.timezone)

    const awakeOverlap = toAxisMin(awakeOverlapA)
    const prefOverlap = toAxisMin(prefOverlapA)
    const nowMin = Math.max(0, Math.min(1440, (nowTick - axisStart) / 60_000))

    // ---- Honest plain-language headline ----------------------------------
    // Prefer the "both prefer to talk" window; if there's none today, fall
    // back to plain "both awake" and say so. Never oversell a thin gap.
    const fmtLocal = (min: number) =>
      new Intl.DateTimeFormat('en-US', {
        timeZone: viewerTz,
        hour: 'numeric',
        minute: '2-digit',
      }).format(axisStart + min * 60_000)

    const usingPref = prefOverlap.length > 0
    const src = usingPref ? prefOverlap : awakeOverlap
    const containing = src.find((iv) => nowMin >= iv.start && nowMin < iv.end)
    const upcoming = src
      .filter((iv) => iv.start > nowMin)
      .sort((a, b) => a.start - b.start)[0]
    const chosen = containing ?? upcoming
    const thin = chosen ? chosen.end - chosen.start <= 45 : false
    const inTxt = (min: number) => {
      const m = Math.round(min)
      return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
    }

    let headline: string
    let tone: 'good' | 'meh' | 'bad'
    if (src.length === 0) {
      headline =
        "You’re never both awake on the same clock today — that’s a rough gap. 💔"
      tone = 'bad'
    } else if (containing) {
      const until = fmtLocal(containing.end)
      headline = usingPref
        ? `💛 Right now is a good time to call — you’re both in your preferred hours until ${until}.`
        : `You’re both awake right now, until ${until} — no shared preferred window, so just pick a moment.`
      tone = usingPref ? 'good' : 'meh'
    } else if (upcoming) {
      const win = `${fmtLocal(upcoming.start)}–${fmtLocal(upcoming.end)}`
      const away = inTxt(upcoming.start - nowMin)
      const short = thin ? ' It’s a short window, so grab it.' : ''
      headline = usingPref
        ? `💛 Good time to call: ${win} your time — in ${away}.${short}`
        : `You’re both awake ${win} your time (in ${away}), but you have no shared preferred hours.`
      tone = usingPref ? 'good' : 'meh'
    } else {
      headline = usingPref
        ? "Today’s good windows have already passed — catch each other tomorrow."
        : "You’re not both awake again until tomorrow."
      tone = 'meh'
    }

    return {
      viewerTz,
      meAwake: toAxisMin(meAwakeA),
      herAwake: toAxisMin(herAwakeA),
      mePref: toAxisMin(mePrefA),
      herPref: toAxisMin(herPrefA),
      awakeOverlap,
      prefOverlap,
      nowMin,
      labelAxis,
      headline,
      tone,
    }
  }, [me, her, nowTick])

  const meName = labelForIdentity('me')
  const herName = labelForIdentity('her')
  void viewer

  const Band = ({
    ints,
    className,
  }: {
    ints: UtcInterval[]
    className: string
  }) => (
    <>
      {ints.map((iv, i) => (
        <div
          key={i}
          className={`absolute top-0 bottom-0 ${className}`}
          style={{ left: pct(iv.start), width: pct(iv.end - iv.start) }}
        />
      ))}
    </>
  )

  const Track = ({
    label,
    awake,
    pref,
  }: {
    label: string
    awake: UtcInterval[]
    pref: UtcInterval[]
  }) => (
    <div className="flex items-center gap-2">
      <span className="w-10 shrink-0 text-xs text-stone-500 text-right">
        {label}
      </span>
      <div className="relative flex-1 h-7 rounded-md bg-stone-100 overflow-hidden">
        <Band ints={awake} className="bg-seal-200" />
        <Band ints={pref} className="bg-seal-400" />
      </div>
    </div>
  )

  const hours = [0, 3, 6, 9, 12, 15, 18, 21, 24]
  const hourLabel = (h: number) =>
    h === 0 || h === 24 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`

  return (
    <div className="rounded-2xl bg-paper ring-1 ring-ink/10 shadow-sm p-6 flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-stone-800">
        🕰 When we’re both around
      </h2>

      <p
        className={`text-sm font-medium leading-snug ${
          data.tone === 'good'
            ? 'text-seal-600'
            : data.tone === 'bad'
              ? 'text-stone-500'
              : 'text-stone-600'
        }`}
      >
        {data.headline}
      </p>

      <div className="relative pl-12 pr-1">
        {/* overlap highlights behind the tracks */}
        <div className="absolute left-12 right-1 top-0 bottom-6">
          <Band ints={data.awakeOverlap} className="bg-seal-100/70" />
          <Band
            ints={data.prefOverlap}
            className="bg-gold-300/70 ring-1 ring-gold-400"
          />
          {/* now marker */}
          <div
            className="absolute top-0 bottom-0 w-px bg-red-500"
            style={{ left: pct(data.nowMin) }}
          >
            <span className="absolute -top-1 -left-1 w-2 h-2 rounded-full bg-red-500" />
          </div>
        </div>

        <div className="relative flex flex-col gap-1.5 py-0">
          <Track label={meName} awake={data.meAwake} pref={data.mePref} />
          <Track label={herName} awake={data.herAwake} pref={data.herPref} />
        </div>

        {/* hour axis, labeled in the viewer's local time */}
        <div className="relative h-5 ml-12 mt-1">
          {hours.map((h) => (
            <span
              key={h}
              className="absolute text-[10px] text-stone-400 -translate-x-1/2"
              style={{ left: pct(h * 60) }}
            >
              {hourLabel(h)}
            </span>
          ))}
        </div>
      </div>

      {/* legend + honest boundary labels in BOTH zones */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-seal-200" /> awake
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-seal-400" /> prefers to talk
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-gold-300 ring-1 ring-gold-400" />{' '}
          good time to call
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-3 bg-red-500" /> now
        </span>
      </div>

      <BoundaryLabels
        title="Both awake"
        ints={data.awakeOverlap}
        label={data.labelAxis}
        empty="You’re never both awake on the same clock — that’s a rough gap."
      />
      <BoundaryLabels
        title="Good time to call"
        ints={data.prefOverlap}
        label={data.labelAxis}
        empty="No overlap in your preferred hours."
      />
    </div>
  )
}

function BoundaryLabels({
  title,
  ints,
  label,
  empty,
}: {
  title: string
  ints: UtcInterval[]
  label: (min: number) => string
  empty: string
}) {
  return (
    <div className="text-sm">
      <span className="font-medium text-stone-700">{title}: </span>
      {ints.length === 0 ? (
        <span className="text-stone-400">{empty}</span>
      ) : (
        <span className="text-stone-600">
          {ints
            .map((iv) => `${label(iv.start)} → ${label(iv.end)}`)
            .join(', ')}
          <span className="text-stone-400"> (your time / her time)</span>
        </span>
      )}
    </div>
  )
}
