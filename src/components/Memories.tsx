import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useRoomChannel } from '../lib/RoomChannel'
import { labelForIdentity, type Identity, type Session } from '../lib/session'

export interface Memory {
  id: string
  room_id: string
  kind: 'drawing' | 'game' | 'answer' | 'note'
  title: string | null
  image_url: string | null
  data: Record<string, unknown> | null
  created_by: string | null
  created_at: string
}

type Filter = 'all' | 'drawing' | 'game' | 'notes'
const CHIPS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'drawing', label: 'Drawings' },
  { key: 'game', label: 'Games' },
  { key: 'notes', label: 'Notes' },
]

function prettyDate(iso: string) {
  // Bare YYYY-MM-DD must parse as LOCAL midnight, or it shows the prior day
  // in western time zones.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`) : new Date(iso)
  return d.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function byName(id: string | null) {
  return id ? labelForIdentity(id as Identity) : 'someone'
}

export function Memories({ session }: { session: Session }) {
  const { on } = useRoomChannel()
  const [items, setItems] = useState<Memory[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [expanded, setExpanded] = useState<Memory | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('memories')
      .select('*')
      .eq('room_id', session.roomCode)
      .order('created_at', { ascending: false })
      .limit(300)
      .then(({ data }) => {
        if (cancelled) return
        setLoading(false)
        if (!data) return
        // Merge so a live-received memory is never clobbered by this load.
        setItems((prev) => {
          const byId = new Map(prev.map((m) => [m.id, m]))
          for (const m of data as Memory[]) if (!byId.has(m.id)) byId.set(m.id, m)
          return [...byId.values()].sort((a, b) =>
            b.created_at.localeCompare(a.created_at),
          )
        })
      })
    return () => {
      cancelled = true
    }
  }, [session.roomCode])

  // A memory saved by either of you appears live.
  useEffect(() => {
    return on('memory:new', (p) => {
      const m = p as Memory
      setItems((prev) => (prev.some((x) => x.id === m.id) ? prev : [m, ...prev]))
    })
  }, [on])

  const visible = useMemo(
    () =>
      items.filter((m) =>
        filter === 'all'
          ? true
          : filter === 'notes'
            ? m.kind === 'note' || m.kind === 'answer'
            : m.kind === filter,
      ),
    [items, filter],
  )

  return (
    <div className="rounded-2xl bg-paper ring-1 ring-ink/10 shadow-sm p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold text-stone-800">📖 Our Memories</h2>
        <div className="flex gap-2 flex-wrap">
          {CHIPS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setFilter(c.key)}
              className={`rounded-full px-3 py-1 text-sm font-medium ${
                filter === c.key
                  ? 'bg-seal-500 text-white'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Running win–loss tally across all saved games */}
      {filter === 'game' && (() => {
        const games = items.filter((m) => m.kind === 'game')
        if (games.length === 0) return null
        const w = { me: 0, her: 0, tie: 0 }
        for (const g of games) {
          const win = (g.data as { winner?: string | null })?.winner
          if (win === 'me') w.me++
          else if (win === 'her') w.her++
          else w.tie++
        }
        return (
          <p className="text-sm text-stone-500 text-center rounded-xl bg-stone-50 py-2">
            🏆 All-time: {labelForIdentity('me')} {w.me} · {labelForIdentity('her')}{' '}
            {w.her} · {w.tie} tie{w.tie === 1 ? '' : 's'}
          </p>
        )
      })()}

      {loading ? (
        <p className="text-stone-400 text-sm text-center py-8">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="text-stone-400 text-sm text-center py-8">
          No memories here yet — go make some 💌
        </p>
      ) : (
        <div className="space-y-4">
          {visible.map((m) => (
            <MemoryCard key={m.id} m={m} onExpand={() => setExpanded(m)} />
          ))}
        </div>
      )}

      {/* Lightbox for drawings */}
      {expanded?.image_url && (
        <div
          className="fixed inset-0 z-50 bg-ink/80 flex items-center justify-center p-6"
          onClick={() => setExpanded(null)}
        >
          <div className="max-w-3xl w-full bg-white p-3 pb-5 shadow-2xl rotate-[-0.5deg]">
            <img
              src={expanded.image_url}
              alt={expanded.title ?? 'drawing'}
              className="w-full"
            />
            <p className="font-script text-2xl text-ink text-center mt-2">
              {expanded.title || 'untitled'} — {byName(expanded.created_by)},{' '}
              {prettyDate(expanded.created_at)}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function MemoryCard({ m, onExpand }: { m: Memory; onExpand: () => void }) {
  const meta = (
    <p className="text-xs text-stone-400 mt-1">
      {byName(m.created_by)} · {prettyDate(m.created_at)}
    </p>
  )

  if (m.kind === 'drawing') {
    return (
      <div className="rounded-2xl border border-stone-100 bg-white p-4">
        <button type="button" onClick={onExpand} className="block w-full">
          <img
            src={m.image_url ?? ''}
            alt={m.title ?? 'drawing'}
            className="rounded-xl border border-stone-100 max-h-56 mx-auto hover:opacity-90 transition"
            loading="lazy"
          />
        </button>
        <p className="font-script text-xl text-ink text-center mt-2">
          {m.title || 'untitled'}
        </p>
        <p className="text-xs text-stone-400 text-center">
          drawn by {byName(m.created_by)} · {prettyDate(m.created_at)}
        </p>
      </div>
    )
  }

  if (m.kind === 'game') {
    const d = (m.data ?? {}) as {
      game?: string
      scores?: { me?: number; her?: number }
      winner?: string | null
    }
    const me = d.scores?.me ?? 0
    const her = d.scores?.her ?? 0
    return (
      <div className="rounded-2xl border border-stone-100 bg-white p-4">
        <div className="flex items-center justify-between">
          <span className="font-medium text-stone-700">
            🏆 {d.game ?? 'Game'}
          </span>
          <span className="text-sm text-stone-500 tabular-nums">
            {labelForIdentity('me')} {me} — {her} {labelForIdentity('her')}
          </span>
        </div>
        <p className="text-sm text-stone-500 mt-1">
          {d.winner
            ? `${byName(d.winner)} won 🎉`
            : me === her
              ? 'A perfect tie 💞'
              : ''}
        </p>
        {meta}
      </div>
    )
  }

  // answer / note — text cards
  const d = (m.data ?? {}) as {
    question?: string
    me?: string
    her?: string
    text?: string
    from?: string
    date?: string
  }
  return (
    <div className="rounded-2xl border border-stone-100 bg-white p-4">
      {m.kind === 'answer' ? (
        <>
          <p className="text-sm text-stone-500">“{d.question ?? m.title}”</p>
          <div className="mt-2 space-y-1">
            {d.me && (
              <p className="font-script text-xl text-ink">
                {labelForIdentity('me')}: {d.me}
              </p>
            )}
            {d.her && (
              <p className="font-script text-xl text-ink">
                {labelForIdentity('her')}: {d.her}
              </p>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="font-script text-2xl text-ink leading-snug">
            {d.text ?? m.title}
          </p>
          {d.from && (
            <p className="font-script text-lg text-seal-600/80 text-right">
              — {byName(d.from)}
            </p>
          )}
        </>
      )}
      <p className="text-xs text-stone-400 mt-1">
        ⭐ starred by {byName(m.created_by)} ·{' '}
        {prettyDate(d.date ?? m.created_at)}
      </p>
    </div>
  )
}
