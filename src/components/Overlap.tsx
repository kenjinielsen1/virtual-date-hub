import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useRoomChannel } from '../lib/RoomChannel'
import { labelForIdentity, type Identity, type Session } from '../lib/session'

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

interface AvailRow {
  timezone: string
  awake_start: string
  awake_end: string
  preferred_start: string | null
  preferred_end: string | null
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

  const [savedTz, setSavedTz] = useState<string | null>(null)
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
    if (mine) {
      setTz(mine.timezone)
      setSavedTz(mine.timezone)
      setAwakeStart(hm(mine.awake_start))
      setAwakeEnd(hm(mine.awake_end))
      setPrefStart(hm(mine.preferred_start))
      setPrefEnd(hm(mine.preferred_end))
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
    if ((prefStart && !prefEnd) || (!prefStart && prefEnd)) {
      setMsg('Set both preferred times, or leave both blank.')
      return
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
        preferred_start: prefStart || null,
        preferred_end: prefEnd || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'room_id,identity' },
    )
    setSaving(false)
    if (error) {
      setMsg(`Couldn't save: ${error.message}`)
      return
    }
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

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={fieldLabel}>
                  Prefer to talk from{' '}
                  <span className="text-stone-400">(optional)</span>
                </label>
                <input
                  type="time"
                  value={prefStart}
                  onChange={(e) => setPrefStart(e.target.value)}
                  className={input + ' w-full'}
                />
              </div>
              <div>
                <label className={fieldLabel}>Preferred until</label>
                <input
                  type="time"
                  value={prefEnd}
                  onChange={(e) => setPrefEnd(e.target.value)}
                  className={input + ' w-full'}
                />
              </div>
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
