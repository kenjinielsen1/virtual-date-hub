import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useRoomChannel } from '../lib/RoomChannel'
import {
  labelForIdentity,
  type Identity,
  type Session,
} from '../lib/session'
import { ResetButton } from './ResetButton'
import { loadStarredIds, saveStarMemory } from '../lib/memories'

// One-way "keep this" star: filled once starred (persists via source_id).
function StarButton({
  starred,
  onStar,
}: {
  starred: boolean
  onStar: () => void
}) {
  return (
    <button
      type="button"
      onClick={starred ? undefined : onStar}
      disabled={starred}
      title={starred ? 'Saved to Memories' : 'Save to Memories'}
      className={`text-lg leading-none ${
        starred
          ? 'text-gold-400 cursor-default'
          : 'text-stone-300 hover:text-gold-400 transition'
      }`}
    >
      {starred ? '★' : '☆'}
    </button>
  )
}

interface Prompt {
  id: string
  category: string
  text: string
}

interface Note {
  id: string
  room_id: string
  sender: string
  body: string
  read: boolean
  created_at: string
}

// UTC date key so both partners get the SAME daily question regardless of the
// time zone they're each in (important for a long-distance couple).
function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

export function DailyNotes({ session }: { session: Session }) {
  return (
    <div className="flex flex-col gap-4">
      <DailyQuestion session={session} />
      <LoveNotes session={session} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Daily question jar
// ---------------------------------------------------------------------------
type Status = 'idle' | 'answering' | 'submitted'

interface DayEntry {
  day_key: string
  prompt_id: string
  me?: string
  her?: string
}

function DailyQuestion({ session }: { session: Session }) {
  const { broadcast, on } = useRoomChannel()
  const partnerId: Identity = session.identity === 'me' ? 'her' : 'me'
  const dayKey = todayKey()

  const [prompts, setPrompts] = useState<Prompt[]>([])
  const [draft, setDraft] = useState('')
  const [mySubmitted, setMySubmitted] = useState(false)
  const [partnerStatus, setPartnerStatus] = useState<Status>('idle')
  const [revealed, setRevealed] = useState(false)
  const [answers, setAnswers] = useState<{ me?: string; her?: string }>({})
  const [history, setHistory] = useState<DayEntry[]>([])
  const [starred, setStarred] = useState<Set<string>>(new Set())

  useEffect(() => {
    loadStarredIds(session.roomCode).then(setStarred)
  }, [session.roomCode])

  async function starAnswer(
    sourceId: string,
    question: string | undefined,
    me: string | undefined,
    her: string | undefined,
    date: string,
  ) {
    setStarred((prev) => new Set(prev).add(sourceId))
    await saveStarMemory(session, broadcast, 'answer', sourceId, {
      question,
      me,
      her,
      date,
    })
  }

  const mySubmittedRef = useRef(false)
  mySubmittedRef.current = mySubmitted

  // One prompt per calendar day, deterministic so both partners match.
  const todayPrompt = useMemo(() => {
    if (prompts.length === 0) return null
    const dayNum = Math.floor(Date.parse(dayKey) / 86_400_000)
    return prompts[dayNum % prompts.length]
  }, [prompts, dayKey])
  const todayRef = useRef<Prompt | null>(null)
  todayRef.current = todayPrompt

  const promptText = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of prompts) map.set(p.id, p.text)
    return map
  }, [prompts])

  // Load the daily prompts once (sorted so the deterministic index is stable).
  useEffect(() => {
    supabase
      .from('prompts')
      .select('*')
      .eq('category', 'daily')
      .order('id')
      .then(({ data }) => {
        if (data) setPrompts(data as Prompt[])
      })
  }, [])

  const reveal = useCallback(
    async (prompt: Prompt) => {
      const { data } = await supabase
        .from('answers')
        .select('sender, body')
        .eq('room_id', session.roomCode)
        .eq('prompt_id', prompt.id)
        .eq('day_key', dayKey)
      if (!data) return
      const map: { me?: string; her?: string } = {}
      for (const r of data) map[r.sender as Identity] = r.body
      setAnswers(map)
      setRevealed(true)
    },
    [session.roomCode, dayKey],
  )

  // Restore today's answers + build the running history.
  useEffect(() => {
    if (!todayPrompt) return
    let cancelled = false
    ;(async () => {
      const { data: today } = await supabase
        .from('answers')
        .select('sender, body')
        .eq('room_id', session.roomCode)
        .eq('prompt_id', todayPrompt.id)
        .eq('day_key', dayKey)
      if (cancelled) return
      if (today && today.length) {
        if (today.some((a) => a.sender === session.identity)) setMySubmitted(true)
        if (today.some((a) => a.sender === partnerId)) setPartnerStatus('submitted')
        if (today.length >= 2) reveal(todayPrompt)
      }

      const { data: all } = await supabase
        .from('answers')
        .select('day_key, prompt_id, sender, body')
        .eq('room_id', session.roomCode)
        .not('day_key', 'is', null)
        .order('day_key', { ascending: false })
      if (cancelled || !all) return
      const byDay = new Map<string, DayEntry>()
      for (const r of all) {
        if (!r.day_key || r.day_key === dayKey) continue
        const entry: DayEntry = byDay.get(r.day_key) ?? {
          day_key: r.day_key,
          prompt_id: r.prompt_id,
        }
        entry[r.sender as Identity] = r.body
        byDay.set(r.day_key, entry)
      }
      setHistory([...byDay.values()].filter((e) => e.me && e.her))
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayPrompt, session.roomCode])

  // Live: partner typing / submitting.
  useEffect(() => {
    const offTyping = on('daily:typing', (p) => {
      if ((p as { sender: Identity }).sender === partnerId)
        setPartnerStatus((s) => (s === 'submitted' ? s : 'answering'))
    })
    const offAnswer = on('daily:answer', (p) => {
      if ((p as { sender: Identity }).sender !== partnerId) return
      setPartnerStatus('submitted')
      const prompt = todayRef.current
      if (prompt && mySubmittedRef.current) reveal(prompt)
    })
    const offReset = on('daily:reset', () => applyReset())
    return () => {
      offTyping()
      offAnswer()
      offReset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, partnerId, reveal])

  function applyReset() {
    setDraft('')
    setMySubmitted(false)
    setPartnerStatus('idle')
    setRevealed(false)
    setAnswers({})
    setHistory([])
  }

  function resetHistory() {
    applyReset()
    broadcast('daily:reset', {})
    // Scope by daily prompt ids so we don't touch trivia / NHIE answers.
    const ids = prompts.map((p) => p.id)
    supabase
      .from('answers')
      .delete()
      .eq('room_id', session.roomCode)
      .in('prompt_id', ids)
      .then(() => {})
  }

  async function submit() {
    const prompt = todayPrompt
    const value = draft.trim()
    if (!prompt || !value || mySubmitted) return
    setMySubmitted(true)
    await supabase.from('answers').insert({
      room_id: session.roomCode,
      prompt_id: prompt.id,
      day_key: dayKey,
      sender: session.identity,
      body: value,
      revealed: false,
    })
    broadcast('daily:answer', { sender: session.identity })
    if (partnerStatus === 'submitted') reveal(prompt)
  }

  const partnerName = labelForIdentity(partnerId)

  return (
    <div className="rounded-2xl bg-paper ring-1 ring-ink/10 shadow-sm p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-stone-800">
          🫙 Question of the Day
        </h2>
        <ResetButton
          label="Clear history"
          confirm="Delete all past daily answers for both of you? This can't be undone."
          onReset={resetHistory}
        />
      </div>

      {!todayPrompt ? (
        <p className="text-stone-400 text-sm">Loading today’s question…</p>
      ) : (
        <>
          <div className="rounded-2xl bg-stone-50 p-5">
            <div className="text-xs uppercase tracking-wide text-stone-400 mb-1">
              {dayKey}
            </div>
            <p className="text-lg text-stone-800">{todayPrompt.text}</p>
          </div>

          <p className="text-sm text-stone-500 h-5">
            {partnerStatus === 'answering' && `${partnerName} is answering…`}
            {partnerStatus === 'submitted' &&
              !revealed &&
              `${partnerName} has answered ✓`}
          </p>

          {!revealed ? (
            mySubmitted ? (
              <p className="text-stone-500 italic">
                Answer saved — it’ll reveal once {partnerName} answers too.
              </p>
            ) : (
              <div className="flex gap-2">
                <input
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value)
                    broadcast('daily:typing', { sender: session.identity })
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && submit()}
                  placeholder="Your answer…"
                  className="flex-1 rounded-xl border border-stone-200 px-3 py-2 outline-none focus:ring-2 focus:ring-seal-300"
                />
                <button
                  type="button"
                  onClick={submit}
                  className="rounded-xl bg-seal-500 text-white px-4 py-2 font-medium hover:bg-seal-600"
                >
                  Answer
                </button>
              </div>
            )
          ) : (
            <div>
              <div className="grid sm:grid-cols-2 gap-3">
                <AnswerCard
                  label="You"
                  answer={session.identity === 'me' ? answers.me : answers.her}
                  tone="pink"
                />
                <AnswerCard
                  label={partnerName}
                  answer={partnerId === 'me' ? answers.me : answers.her}
                  tone="purple"
                />
              </div>
              <div className="flex justify-end mt-2 items-center gap-1.5">
                <span className="text-xs text-stone-400">keep this one</span>
                <StarButton
                  starred={starred.has(`${todayPrompt.id}:${dayKey}`)}
                  onStar={() =>
                    starAnswer(
                      `${todayPrompt.id}:${dayKey}`,
                      todayPrompt.text,
                      answers.me,
                      answers.her,
                      dayKey,
                    )
                  }
                />
              </div>
            </div>
          )}

          {history.length > 0 && (
            <div className="mt-2">
              <h3 className="text-sm font-semibold text-stone-500 mb-2">
                Past days ({history.length})
              </h3>
              <div className="space-y-3">
                {history.map((e) => (
                  <div key={e.day_key} className="rounded-2xl bg-stone-50 p-4">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-stone-400">{e.day_key}</span>
                      <StarButton
                        starred={starred.has(`${e.prompt_id}:${e.day_key}`)}
                        onStar={() =>
                          starAnswer(
                            `${e.prompt_id}:${e.day_key}`,
                            promptText.get(e.prompt_id),
                            e.me,
                            e.her,
                            e.day_key,
                          )
                        }
                      />
                    </div>
                    <p className="text-sm text-stone-700 mb-2">
                      {promptText.get(e.prompt_id) ?? '—'}
                    </p>
                    <div className="grid sm:grid-cols-2 gap-2 text-sm">
                      <div className="rounded-xl bg-seal-50 border border-seal-100 p-2">
                        <span className="text-xs text-stone-500">
                          {labelForIdentity('me')}:{' '}
                        </span>
                        {e.me}
                      </div>
                      <div className="rounded-xl bg-gold-50 border border-gold-100 p-2">
                        <span className="text-xs text-stone-500">
                          {labelForIdentity('her')}:{' '}
                        </span>
                        {e.her}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Love notes
// ---------------------------------------------------------------------------
function LoveNotes({ session }: { session: Session }) {
  const { broadcast, on } = useRoomChannel()
  const partnerId: Identity = session.identity === 'me' ? 'her' : 'me'
  const [notes, setNotes] = useState<Note[]>([])
  const [draft, setDraft] = useState('')
  const [starred, setStarred] = useState<Set<string>>(new Set())

  useEffect(() => {
    loadStarredIds(session.roomCode).then(setStarred)
  }, [session.roomCode])

  async function starNote(n: Note) {
    setStarred((prev) => new Set(prev).add(n.id))
    await saveStarMemory(session, broadcast, 'note', n.id, {
      text: n.body,
      from: n.sender,
      date: n.created_at,
    })
  }

  // Break the wax seal on a partner's note: reveal it + mark read. The window
  // event lets the tab badge decrement (RoomShell listens for it).
  const openNote = useCallback(async (id: string) => {
    setNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
    )
    window.dispatchEvent(
      new CustomEvent('vdh:note-read', { detail: { count: 1 } }),
    )
    await supabase.from('notes').update({ read: true }).eq('id', id)
  }, [])

  // Load notes (partner's unread ones stay sealed until opened).
  useEffect(() => {
    let cancelled = false
    supabase
      .from('notes')
      .select('*')
      .eq('room_id', session.roomCode)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (!cancelled && data) setNotes(data as Note[])
      })
    return () => {
      cancelled = true
    }
  }, [session.roomCode])

  // Live: a new note from either side + reset.
  useEffect(() => {
    const offNew = on('note:new', (p) => {
      const n = p as Note
      setNotes((prev) => (prev.some((x) => x.id === n.id) ? prev : [n, ...prev]))
    })
    const offReset = on('notes:reset', () => setNotes([]))
    return () => {
      offNew()
      offReset()
    }
  }, [on])

  function resetNotes() {
    setNotes([])
    broadcast('notes:reset', {})
    supabase
      .from('notes')
      .delete()
      .eq('room_id', session.roomCode)
      .then(() => {})
  }

  async function send() {
    const body = draft.trim()
    if (!body) return
    setDraft('')
    const note: Note = {
      id: crypto.randomUUID(),
      room_id: session.roomCode,
      sender: session.identity,
      body,
      read: false,
      created_at: new Date().toISOString(),
    }
    setNotes((prev) => [note, ...prev])
    broadcast('note:new', note)
    await supabase.from('notes').insert({
      id: note.id,
      room_id: note.room_id,
      sender: note.sender,
      body,
    })
  }

  return (
    <div className="rounded-2xl bg-paper ring-1 ring-ink/10 shadow-sm p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-stone-800">💌 Love Notes</h2>
        <ResetButton
          label="Clear notes"
          confirm="Delete all love notes for both of you? This can't be undone."
          onReset={resetNotes}
        />
      </div>

      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder={`Leave a little note for ${labelForIdentity(partnerId)}…`}
          className="flex-1 rounded-xl border border-stone-200 px-3 py-2 outline-none focus:ring-2 focus:ring-seal-300"
        />
        <button
          type="button"
          onClick={send}
          className="rounded-xl bg-seal-500 text-white px-4 py-2 font-medium hover:bg-seal-600"
        >
          Send
        </button>
      </div>

      {notes.length === 0 ? (
        <p className="text-stone-400 text-sm text-center py-4">
          No notes yet — surprise {labelForIdentity(partnerId)} with one 💕
        </p>
      ) : (
        <div className="space-y-2">
          {notes.map((n) => {
            const mine = n.sender === session.identity
            const sealed = !mine && !n.read

            // A partner's unopened note shows as a sealed letter.
            if (sealed) {
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => openNote(n.id)}
                  className="w-full rounded-2xl border border-seal-200 bg-seal-50/60 p-5 flex items-center gap-4 hover:bg-seal-50 transition text-left group"
                >
                  <span className="shrink-0 w-11 h-11 rounded-full bg-seal-600 text-cream flex items-center justify-center text-lg shadow-inner group-hover:scale-105 transition">
                    ♥
                  </span>
                  <span>
                    <span className="block font-script text-2xl text-seal-700 leading-none">
                      A note from {labelForIdentity(n.sender as Identity)}
                    </span>
                    <span className="text-xs text-stone-500">
                      Tap to break the seal
                    </span>
                  </span>
                </button>
              )
            }

            return (
              <div
                key={n.id}
                className={`rounded-2xl p-4 ${
                  mine
                    ? 'bg-seal-50 border border-seal-100'
                    : 'bg-gold-50 border border-gold-100'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] uppercase tracking-wide text-stone-400">
                    {new Date(n.created_at).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                  <StarButton
                    starred={starred.has(n.id)}
                    onStar={() => starNote(n)}
                  />
                </div>
                <p className="font-script text-2xl leading-snug text-ink whitespace-pre-wrap break-words">
                  {n.body}
                </p>
                <p className="font-script text-xl text-seal-600/80 text-right mt-1">
                  — {mine ? session.displayName : labelForIdentity(n.sender as Identity)}
                </p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function AnswerCard({
  label,
  answer,
  tone,
}: {
  label: string
  answer?: string
  tone: 'pink' | 'purple'
}) {
  const tones = {
    pink: 'bg-seal-50 border-seal-200',
    purple: 'bg-gold-50 border-gold-200',
  }
  return (
    <div className={`rounded-2xl border-2 ${tones[tone]} p-4`}>
      <div className="text-xs font-medium text-stone-500 mb-1">{label}</div>
      <div className="text-stone-800">{answer ?? '—'}</div>
    </div>
  )
}
