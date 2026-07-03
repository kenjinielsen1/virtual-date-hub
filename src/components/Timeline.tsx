import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useRoomChannel } from '../lib/RoomChannel'
import { labelForIdentity, type Identity, type Session } from '../lib/session'
import { ResetButton } from './ResetButton'

interface Milestone {
  id: string
  room_id: string
  event_date: string
  title: string
  description: string | null
  photo_url: string | null
  created_by: string | null
  created_at: string
}

const STORAGE_BUCKET = 'timeline'

function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}

// Sort oldest -> newest so the timeline reads like a story.
function byDate(a: Milestone, b: Milestone) {
  return a.event_date === b.event_date
    ? a.created_at.localeCompare(b.created_at)
    : a.event_date.localeCompare(b.event_date)
}

export function Timeline({ session }: { session: Session }) {
  const { broadcast, on } = useRoomChannel()
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [date, setDate] = useState(todayLocal())
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    supabase
      .from('milestones')
      .select('*')
      .eq('room_id', session.roomCode)
      .order('event_date', { ascending: true })
      .then(({ data }) => {
        if (!cancelled && data) setMilestones(data as Milestone[])
      })
    return () => {
      cancelled = true
    }
  }, [session.roomCode])

  useEffect(() => {
    const offNew = on('milestone:new', (p) => {
      const m = p as Milestone
      setMilestones((prev) =>
        prev.some((x) => x.id === m.id) ? prev : [...prev, m].sort(byDate),
      )
    })
    const offReset = on('timeline:reset', () => setMilestones([]))
    return () => {
      offNew()
      offReset()
    }
  }, [on])

  function resetTimeline() {
    setMilestones([])
    broadcast('timeline:reset', {})
    supabase
      .from('milestones')
      .delete()
      .eq('room_id', session.roomCode)
      .then(() => {})
  }

  async function addMilestone() {
    if (!title.trim() || saving) return
    setSaving(true)
    setError('')

    let photo_url: string | null = null
    try {
      if (file) {
        const ext = file.name.split('.').pop() ?? 'jpg'
        const path = `${session.roomCode}/${crypto.randomUUID()}.${ext}`
        const { error: upErr } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(path, file, { upsert: false })
        if (upErr) throw upErr
        photo_url = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path)
          .data.publicUrl
      }

      const { data, error: insErr } = await supabase
        .from('milestones')
        .insert({
          room_id: session.roomCode,
          event_date: date,
          title: title.trim(),
          description: description.trim() || null,
          photo_url,
          created_by: session.identity,
        })
        .select()
        .single()
      if (insErr) throw insErr

      const row = data as Milestone
      setMilestones((prev) => [...prev, row].sort(byDate))
      broadcast('milestone:new', row)

      // Reset the form.
      setTitle('')
      setDescription('')
      setFile(null)
      setDate(todayLocal())
    } catch (e) {
      setError(
        e instanceof Error
          ? `Couldn't save: ${e.message}`
          : "Couldn't save the milestone.",
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Add entry */}
      <div className="rounded-2xl bg-paper ring-1 ring-ink/10 shadow-sm p-6 flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-stone-800">📸 Add a milestone</h2>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-xl border border-stone-200 px-3 py-2 outline-none focus:ring-2 focus:ring-seal-300"
          />
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (e.g. Our first date)"
            className="flex-1 rounded-xl border border-stone-200 px-3 py-2 outline-none focus:ring-2 focus:ring-seal-300"
          />
        </div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What happened? (optional)"
          rows={2}
          className="rounded-xl border border-stone-200 px-3 py-2 outline-none focus:ring-2 focus:ring-seal-300 resize-none"
        />
        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm text-stone-500 file:mr-3 file:rounded-lg file:border-0 file:bg-seal-100 file:text-seal-700 file:px-3 file:py-1.5 file:font-medium"
          />
          <button
            type="button"
            onClick={addMilestone}
            disabled={saving || !title.trim()}
            className="ml-auto rounded-xl bg-seal-500 text-white px-5 py-2 font-medium hover:bg-seal-600 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Add to timeline'}
          </button>
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>

      {/* Timeline */}
      <div className="rounded-2xl bg-paper ring-1 ring-ink/10 shadow-sm p-6">
        {milestones.length > 0 && (
          <div className="flex justify-end mb-2">
            <ResetButton
              label="Clear timeline"
              confirm="Delete all timeline milestones for both of you? This can't be undone."
              onReset={resetTimeline}
            />
          </div>
        )}
        {milestones.length === 0 ? (
          <p className="text-stone-400 text-sm text-center py-6">
            No milestones yet — add your first memory above 💕
          </p>
        ) : (
          <ol className="relative border-l-2 border-seal-200 ml-3 space-y-8">
            {milestones.map((m) => (
              <li key={m.id} className="ml-6">
                <span className="absolute -left-[9px] w-4 h-4 rounded-full bg-seal-500 ring-4 ring-cream" />
                <div className="text-xs text-stone-400">
                  {new Date(m.event_date + 'T00:00:00').toLocaleDateString(
                    undefined,
                    { year: 'numeric', month: 'long', day: 'numeric' },
                  )}
                  {m.created_by &&
                    ` · added by ${labelForIdentity(m.created_by as Identity)}`}
                </div>
                <h3 className="text-lg font-semibold text-stone-800">
                  {m.title}
                </h3>
                {m.description && (
                  <p className="text-stone-600 whitespace-pre-wrap mt-0.5">
                    {m.description}
                  </p>
                )}
                {m.photo_url && (
                  // Scrapbook photo mount with washi-tape corners.
                  <div className="mt-3 relative inline-block bg-white p-2 pb-4 shadow-md rotate-[-1deg]">
                    <span className="absolute -top-2 left-6 w-14 h-5 bg-gold-200/50 -rotate-6 shadow-sm" />
                    <span className="absolute -top-2 right-6 w-14 h-5 bg-gold-200/50 rotate-6 shadow-sm" />
                    <img
                      src={m.photo_url}
                      alt={m.title}
                      className="block max-h-80 object-cover"
                    />
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}
