import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useRoomChannel } from '../lib/RoomChannel'
import { labelForIdentity, type Identity, type Session } from '../lib/session'
import { ResetButton } from './ResetButton'
import { saveGameMemory } from '../lib/memories'

interface Prompt {
  id: string
  category: string
  text: string
  option_a: string | null
  option_b: string | null
}

interface Scores {
  me: number
  her: number
}

type PartnerStatus = 'idle' | 'answering' | 'submitted'

// Normalize free-text answers so "Pizza " and "pizza" count as a match.
function normalize(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

// "How well do you know each other" rounds are ABOUT one person: they answer
// honestly, the partner guesses. Derive the subject deterministically from the
// prompt id so both clients agree and it survives a refresh (no extra storage).
function subjectFor(prompt: Prompt): Identity {
  let sum = 0
  for (const c of prompt.id) sum += c.charCodeAt(0)
  return sum % 2 === 0 ? 'me' : 'her'
}

export function Trivia({ session }: { session: Session }) {
  const { broadcast, on } = useRoomChannel()
  const partnerId: Identity = session.identity === 'me' ? 'her' : 'me'

  const [prompts, setPrompts] = useState<Prompt[]>([])
  const [current, setCurrent] = useState<Prompt | null>(null)
  const [draft, setDraft] = useState('') // free-text answer for how_well
  const [mySubmitted, setMySubmitted] = useState(false)
  const [myAnswer, setMyAnswer] = useState<string | null>(null)
  const [partnerStatus, setPartnerStatus] = useState<PartnerStatus>('idle')
  const [revealed, setRevealed] = useState(false)
  const [answers, setAnswers] = useState<{ me?: string; her?: string }>({})
  const [scores, setScores] = useState<Scores>({ me: 0, her: 0 })
  const [lastResult, setLastResult] = useState<'match' | 'nomatch' | null>(null)

  // Prompts we've already scored, so we never double-count a point.
  const scoredRef = useRef<Set<string>>(new Set())
  const currentRef = useRef<Prompt | null>(null)
  currentRef.current = current
  // Refs mirror state so channel callbacks read fresh values without re-binding.
  const mySubmittedRef = useRef(false)
  mySubmittedRef.current = mySubmitted

  // --- Load trivia prompts once. ---
  useEffect(() => {
    supabase
      .from('prompts')
      .select('*')
      .in('category', ['would_you_rather', 'how_well'])
      .then(({ data }) => {
        if (data) setPrompts(data as Prompt[])
      })
  }, [])

  const resetForPrompt = useCallback(() => {
    setDraft('')
    setMySubmitted(false)
    setMyAnswer(null)
    setPartnerStatus('idle')
    setRevealed(false)
    setAnswers({})
    setLastResult(null)
  }, [])

  // Reveal both answers + (me = authority) award a point on a fresh match.
  const revealAnswers = useCallback(
    async (prompt: Prompt, award: boolean) => {
      const { data } = await supabase
        .from('answers')
        .select('sender, body')
        .eq('room_id', session.roomCode)
        .eq('prompt_id', prompt.id)
      if (!data) return
      const map: { me?: string; her?: string } = {}
      for (const row of data) map[row.sender as Identity] = row.body
      setAnswers(map)
      setRevealed(true)

      const matched =
        map.me != null && map.her != null && normalize(map.me) === normalize(map.her)
      setLastResult(matched ? 'match' : 'nomatch')

      // Only "me" writes the score, and only once per prompt, and only when this
      // reveal is caused by a live submission (not restoring an old one).
      if (
        award &&
        matched &&
        session.identity === 'me' &&
        !scoredRef.current.has(prompt.id)
      ) {
        scoredRef.current.add(prompt.id)
        const next: Scores = { me: scores.me + 1, her: scores.her + 1 }
        setScores(next)
        broadcast('trivia:score', next)
        await supabase
          .from('room_state')
          .upsert({ room_id: session.roomCode, scores: next })
      } else if (matched) {
        // Ensure we don't award later for a prompt already resolved.
        scoredRef.current.add(prompt.id)
      }
    },
    [session.roomCode, session.identity, scores, broadcast],
  )

  // --- Restore room state (scores + current question) on mount. ---
  useEffect(() => {
    if (prompts.length === 0) return
    let cancelled = false
    supabase
      .from('room_state')
      .select('scores, trivia_prompt_id')
      .eq('room_id', session.roomCode)
      .maybeSingle()
      .then(async ({ data }) => {
        if (cancelled || !data) return
        if (data.scores) setScores(data.scores as Scores)
        if (data.trivia_prompt_id) {
          const prompt = prompts.find((p) => p.id === data.trivia_prompt_id)
          if (!prompt) return
          setCurrent(prompt)
          // Restore any answers already given for this prompt.
          const { data: ans } = await supabase
            .from('answers')
            .select('sender, body')
            .eq('room_id', session.roomCode)
            .eq('prompt_id', prompt.id)
          if (ans && ans.length) {
            const mine = ans.find((a) => a.sender === session.identity)
            if (mine) {
              setMySubmitted(true)
              setMyAnswer(mine.body)
            }
            if (ans.some((a) => a.sender === partnerId))
              setPartnerStatus('submitted')
            // Both already answered → show the resolved state (no re-scoring).
            if (ans.length >= 2) {
              scoredRef.current.add(prompt.id)
              revealAnswers(prompt, false)
            }
          }
        }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompts, session.roomCode])

  // --- Live channel subscriptions. ---
  useEffect(() => {
    const offPrompt = on('trivia:prompt', (p) => {
      const { promptId } = p as { promptId: string }
      const prompt = prompts.find((x) => x.id === promptId)
      if (prompt) {
        resetForPrompt()
        setCurrent(prompt)
      }
    })
    const offTyping = on('trivia:typing', (p) => {
      if ((p as { sender: Identity }).sender === partnerId)
        setPartnerStatus((s) => (s === 'submitted' ? s : 'answering'))
    })
    const offAnswer = on('trivia:answer', async (p) => {
      if ((p as { sender: Identity }).sender !== partnerId) return
      setPartnerStatus('submitted')
      // If I've also submitted, both are in → reveal (award).
      const prompt = currentRef.current
      if (prompt && mySubmittedRef.current) revealAnswers(prompt, true)
    })
    const offScore = on('trivia:score', (p) => setScores(p as Scores))
    const offReset = on('trivia:reset', () => applyReset())
    return () => {
      offPrompt()
      offTyping()
      offAnswer()
      offScore()
      offReset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, prompts, partnerId, revealAnswers, resetForPrompt])

  function applyReset() {
    resetForPrompt()
    setCurrent(null)
    setScores({ me: 0, her: 0 })
    scoredRef.current.clear()
  }

  function resetGame() {
    // Capture the final scoreboard as a memory before clearing.
    saveGameMemory(
      session,
      broadcast,
      'Trivia',
      scores,
      scores.me > scores.her ? 'me' : scores.her > scores.me ? 'her' : null,
    )
    applyReset()
    broadcast('trivia:reset', {})
    // Wipe only this game's answers (scoped by trivia prompt ids so we don't
    // touch daily / never-have-i-ever answers) + reset scores/current question.
    const ids = prompts.map((p) => p.id)
    supabase
      .from('answers')
      .delete()
      .eq('room_id', session.roomCode)
      .in('prompt_id', ids)
      .then(() =>
        supabase.from('room_state').upsert({
          room_id: session.roomCode,
          scores: { me: 0, her: 0 },
          trivia_prompt_id: null,
        }),
      )
  }

  async function pickNewQuestion() {
    if (prompts.length === 0) return
    // Don't repeat questions already answered this round (until Reset).
    // Answered prompts have answer rows; trivia answers have a null day_key.
    const { data } = await supabase
      .from('answers')
      .select('prompt_id')
      .eq('room_id', session.roomCode)
      .is('day_key', null)
    const seen = new Set((data ?? []).map((r) => r.prompt_id as string))
    let pool = prompts.filter((p) => !seen.has(p.id) && p.id !== current?.id)
    // Every question used → start the bank over.
    const exhausted = pool.length === 0
    if (exhausted) pool = prompts.filter((p) => p.id !== current?.id)
    if (pool.length === 0) pool = prompts
    const next = pool[Math.floor(Math.random() * pool.length)]
    // Only when recycling a seen prompt do we clear its old answers.
    if (exhausted) {
      await supabase
        .from('answers')
        .delete()
        .eq('room_id', session.roomCode)
        .eq('prompt_id', next.id)
    }
    resetForPrompt()
    setCurrent(next)
    scoredRef.current.delete(next.id)
    broadcast('trivia:prompt', { promptId: next.id })
    supabase
      .from('room_state')
      .upsert({ room_id: session.roomCode, trivia_prompt_id: next.id })
      .then(() => {})
  }

  function notifyTyping() {
    broadcast('trivia:typing', { sender: session.identity })
  }

  async function submit(value: string) {
    const prompt = current
    if (!prompt || !value.trim() || mySubmitted) return
    setMySubmitted(true)
    setMyAnswer(value)
    // Plain insert: stale answers are cleared when a question starts and
    // double-submit is guarded, so there's no conflict to upsert against.
    await supabase.from('answers').insert({
      room_id: session.roomCode,
      prompt_id: prompt.id,
      sender: session.identity,
      body: value,
      revealed: false,
    })
    broadcast('trivia:answer', { sender: session.identity })
    // If partner already submitted, both are in → reveal now.
    if (partnerStatus === 'submitted') revealAnswers(prompt, true)
  }

  // ---------------------------------------------------------------------------
  const isWyr = current?.category === 'would_you_rather'
  const nameOf = (id: Identity) =>
    id === session.identity ? session.displayName : labelForIdentity(id)
  const partnerName = nameOf(partnerId)

  // For "how well" rounds: who the question is about, and my role in it.
  const subject: Identity | null =
    current && !isWyr ? subjectFor(current) : null
  const iAmSubject = subject === session.identity
  const subjectName = subject ? nameOf(subject) : ''

  return (
    <div className="rounded-2xl bg-paper ring-1 ring-ink/10 shadow-sm p-6 flex flex-col gap-5">
      {/* Scoreboard */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-stone-800">💭 Couples Trivia</h2>
        <div className="flex items-center gap-3 text-sm">
          <span className="rounded-full bg-seal-100 text-seal-700 px-3 py-1 font-medium">
            You {session.identity === 'me' ? scores.me : scores.her}
          </span>
          <span className="rounded-full bg-gold-100 text-gold-700 px-3 py-1 font-medium">
            {partnerName} {partnerId === 'me' ? scores.me : scores.her}
          </span>
          <ResetButton
            label="Finish game"
            confirm="Finish this trivia game? The final score is saved to Memories, then scores and answers reset for both of you."
            onReset={resetGame}
          />
        </div>
      </div>

      {!current && (
        <div className="text-center py-8">
          <p className="text-stone-500 mb-4">
            Pick a question and answer it together — points when you match!
          </p>
          <button
            type="button"
            onClick={pickNewQuestion}
            className="rounded-xl bg-seal-500 text-white px-5 py-2.5 font-medium hover:bg-seal-600"
          >
            Start with a question
          </button>
        </div>
      )}

      {current && (
        <>
          <div className="rounded-2xl bg-stone-50 p-5">
            <div className="text-xs uppercase tracking-wide text-stone-400 mb-1">
              {isWyr ? 'Would you rather' : `How well do you know ${subjectName}?`}
            </div>
            <p className="text-lg text-stone-800">{current.text}</p>
            {!isWyr && (
              <p className="mt-3 text-sm font-medium text-seal-600">
                {iAmSubject
                  ? '🎯 This one’s about you — answer honestly!'
                  : `🤔 Guess how ${subjectName} would answer.`}
              </p>
            )}
          </div>

          {/* Partner liveness */}
          <p className="text-sm text-stone-500 h-5">
            {partnerStatus === 'answering' && `${partnerName} is answering…`}
            {partnerStatus === 'submitted' &&
              !revealed &&
              `${partnerName} has submitted ✓`}
          </p>

          {/* Answer area */}
          {!revealed ? (
            mySubmitted ? (
              <p className="text-stone-500 italic">
                Your answer is locked in — waiting for {partnerName}…
              </p>
            ) : isWyr ? (
              <div className="grid sm:grid-cols-2 gap-3">
                {[current.option_a, current.option_b].map(
                  (opt) =>
                    opt && (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => submit(opt)}
                        className="rounded-2xl border-2 border-stone-200 hover:border-seal-400 hover:bg-seal-50 p-4 text-left text-stone-700 transition"
                      >
                        {opt}
                      </button>
                    ),
                )}
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value)
                    notifyTyping()
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && submit(draft)}
                  placeholder={
                    iAmSubject ? 'Your honest answer…' : `Guess ${subjectName}’s answer…`
                  }
                  className="flex-1 rounded-xl border border-stone-200 px-3 py-2 outline-none focus:ring-2 focus:ring-seal-300"
                />
                <button
                  type="button"
                  onClick={() => submit(draft)}
                  className="rounded-xl bg-seal-500 text-white px-4 py-2 font-medium hover:bg-seal-600"
                >
                  Submit
                </button>
              </div>
            )
          ) : (
            <div className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-3">
                <AnswerCard
                  label={
                    isWyr
                      ? 'You'
                      : iAmSubject
                        ? 'You (the real answer)'
                        : 'You (your guess)'
                  }
                  answer={session.identity === 'me' ? answers.me : answers.her}
                  tone="pink"
                />
                <AnswerCard
                  label={
                    isWyr
                      ? partnerName
                      : subject === partnerId
                        ? `${partnerName} (the real answer)`
                        : `${partnerName} (their guess)`
                  }
                  answer={partnerId === 'me' ? answers.me : answers.her}
                  tone="purple"
                />
              </div>
              {lastResult === 'match' && (
                <p className="text-center text-green-600 font-semibold">
                  {isWyr
                    ? '🎉 You matched! +1 each'
                    : `🎉 Nailed it — ${subjectName}’s answer was guessed! +1 each`}
                </p>
              )}
              {lastResult === 'nomatch' && (
                <p className="text-center text-stone-500">
                  {isWyr ? 'Not a match this time 😅' : 'Not quite this time 😅'}
                </p>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={pickNewQuestion}
            className="self-center text-sm text-seal-600 hover:text-seal-700 font-medium"
          >
            Next question →
          </button>

          {/* Fallback if my answer exists but partner hasn't matched view */}
          {myAnswer && !revealed && (
            <p className="text-xs text-stone-400 text-center">
              You answered: “{myAnswer}”
            </p>
          )}
        </>
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
