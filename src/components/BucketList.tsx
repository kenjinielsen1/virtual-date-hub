import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useRoomChannel } from '../lib/RoomChannel'
import { labelForIdentity, type Identity, type Session } from '../lib/session'
import { ResetButton } from './ResetButton'

type Category = 'places' | 'dates' | 'someday'

interface Item {
  id: string
  room_id: string
  item: string
  category: Category
  done: boolean
  photo_url: string | null
  added_by: string | null
  created_at: string
}

const CATEGORIES: { key: Category; label: string; emoji: string }[] = [
  { key: 'places', label: 'Places', emoji: '🗺️' },
  { key: 'dates', label: 'Dates', emoji: '💞' },
  { key: 'someday', label: 'Someday', emoji: '✨' },
]

const STORAGE_BUCKET = 'timeline' // reuse the timeline bucket for photos

export function BucketList({ session }: { session: Session }) {
  const { broadcast, on } = useRoomChannel()
  const [items, setItems] = useState<Item[]>([])
  const [text, setText] = useState('')
  const [category, setCategory] = useState<Category>('places')
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Category | 'all'>('all')

  useEffect(() => {
    let cancelled = false
    supabase
      .from('bucket_list')
      .select('*')
      .eq('room_id', session.roomCode)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (cancelled || !data) return
        // Merge (don't clobber optimistic/live items).
        setItems((prev) => {
          const byId = new Map(prev.map((i) => [i.id, i]))
          for (const i of data as Item[]) if (!byId.has(i.id)) byId.set(i.id, i)
          return [...byId.values()].sort((a, b) =>
            a.created_at.localeCompare(b.created_at),
          )
        })
      })
    return () => {
      cancelled = true
    }
  }, [session.roomCode])

  useEffect(() => {
    const offNew = on('bucket:new', (p) => {
      const it = p as Item
      setItems((prev) => (prev.some((x) => x.id === it.id) ? prev : [...prev, it]))
    })
    const offToggle = on('bucket:toggle', (p) => {
      const { id, done } = p as { id: string; done: boolean }
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, done } : i)))
    })
    const offDel = on('bucket:delete', (p) => {
      const { id } = p as { id: string }
      setItems((prev) => prev.filter((i) => i.id !== id))
    })
    const offReset = on('bucket:reset', () => setItems([]))
    return () => {
      offNew()
      offToggle()
      offDel()
      offReset()
    }
  }, [on])

  async function add() {
    if (!text.trim() || saving) return
    setSaving(true)
    setError('')
    let photo_url: string | null = null
    try {
      if (file) {
        const ext = file.name.split('.').pop() ?? 'jpg'
        const path = `${session.roomCode}/bucket/${crypto.randomUUID()}.${ext}`
        const { error: upErr } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(path, file)
        if (upErr) throw upErr
        photo_url = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path)
          .data.publicUrl
      }
      // Optimistic: client-generated id so it syncs live even before the row
      // is persisted, and is never lost to a slow insert.
      const row: Item = {
        id: crypto.randomUUID(),
        room_id: session.roomCode,
        item: text.trim(),
        category,
        done: false,
        photo_url,
        added_by: session.identity,
        created_at: new Date().toISOString(),
      }
      setItems((prev) => [...prev, row])
      broadcast('bucket:new', row)
      setText('')
      setFile(null)
      const { error: insErr } = await supabase.from('bucket_list').insert({
        id: row.id,
        room_id: row.room_id,
        item: row.item,
        category: row.category,
        added_by: row.added_by,
        photo_url,
      })
      if (insErr) throw insErr
    } catch (e) {
      setError(e instanceof Error ? `Couldn't add: ${e.message}` : "Couldn't add.")
    } finally {
      setSaving(false)
    }
  }

  function toggle(it: Item) {
    const done = !it.done
    setItems((prev) => prev.map((i) => (i.id === it.id ? { ...i, done } : i)))
    broadcast('bucket:toggle', { id: it.id, done })
    supabase.from('bucket_list').update({ done }).eq('id', it.id).then(() => {})
  }

  function remove(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id))
    broadcast('bucket:delete', { id })
    supabase.from('bucket_list').delete().eq('id', id).then(() => {})
  }

  function resetAll() {
    setItems([])
    broadcast('bucket:reset', {})
    supabase.from('bucket_list').delete().eq('room_id', session.roomCode).then(() => {})
  }

  const doneCount = items.filter((i) => i.done).length
  const pct = items.length ? Math.round((doneCount / items.length) * 100) : 0
  const visible = useMemo(
    () => (filter === 'all' ? items : items.filter((i) => i.category === filter)),
    [items, filter],
  )

  return (
    <div className="flex flex-col gap-4">
      {/* Add */}
      <div className="rounded-2xl bg-paper ring-1 ring-ink/10 shadow-sm p-6 flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-stone-800">🪣 Our Bucket List</h2>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="Something to do together…"
            className="flex-1 rounded-xl border border-stone-200 px-3 py-2 outline-none focus:ring-2 focus:ring-seal-300"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as Category)}
            className="rounded-xl border border-stone-200 px-3 py-2 outline-none focus:ring-2 focus:ring-seal-300"
          >
            {CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.emoji} {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm text-stone-500 file:mr-3 file:rounded-lg file:border-0 file:bg-seal-100 file:text-seal-700 file:px-3 file:py-1.5 file:font-medium"
          />
          <button
            type="button"
            onClick={add}
            disabled={saving || !text.trim()}
            className="ml-auto rounded-xl bg-seal-500 text-white px-5 py-2 font-medium hover:bg-seal-600 disabled:opacity-50"
          >
            {saving ? 'Adding…' : 'Add'}
          </button>
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>

      {/* Progress + filter */}
      <div className="rounded-2xl bg-paper ring-1 ring-ink/10 shadow-sm p-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-stone-600">
            {doneCount} of {items.length} done
          </span>
          {items.length > 0 && (
            <ResetButton
              label="Clear list"
              confirm="Delete the whole bucket list for both of you?"
              onReset={resetAll}
            />
          )}
        </div>
        <div className="h-3 rounded-full bg-stone-100 overflow-hidden mb-4">
          <div
            className="h-full bg-gradient-to-r from-seal-500 to-gold-500 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="flex gap-2 mb-4 flex-wrap">
          {(['all', 'places', 'dates', 'someday'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1 text-sm font-medium capitalize ${
                filter === f
                  ? 'bg-seal-500 text-white'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {visible.length === 0 ? (
          <p className="text-stone-400 text-sm text-center py-6">
            Nothing here yet — add a dream 💫
          </p>
        ) : (
          <ul className="space-y-2">
            {visible.map((it) => {
              const cat = CATEGORIES.find((c) => c.key === it.category)
              return (
                <li
                  key={it.id}
                  className="flex items-center gap-3 rounded-2xl border border-stone-100 bg-white p-3"
                >
                  <button
                    type="button"
                    onClick={() => toggle(it)}
                    className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                      it.done
                        ? 'bg-seal-500 border-seal-500 text-white'
                        : 'border-stone-300'
                    }`}
                    aria-label={it.done ? 'mark not done' : 'mark done'}
                  >
                    {it.done ? '✓' : ''}
                  </button>
                  {it.photo_url && (
                    <img
                      src={it.photo_url}
                      alt={it.item}
                      className="w-12 h-12 rounded-lg object-cover shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div
                      className={`${
                        it.done ? 'line-through text-stone-400' : 'text-stone-800'
                      }`}
                    >
                      {it.item}
                    </div>
                    <div className="text-xs text-stone-400">
                      {cat?.emoji} {cat?.label}
                      {it.added_by &&
                        ` · ${labelForIdentity(it.added_by as Identity)}`}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(it.id)}
                    className="text-xs text-stone-400 hover:text-red-500 shrink-0"
                  >
                    remove
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
