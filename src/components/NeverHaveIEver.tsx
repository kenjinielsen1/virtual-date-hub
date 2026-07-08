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
}

type Choice = 'have' | 'havent'
type Status = 'idle' | 'answering' | 'submitted'

export function NeverHaveIEver({ session }: { session: Session }) {
  const { broadcast, on } = useRoomChannel()
  const partnerId: Identity = session.identity === 'me' ? 'her' : 'me'

  const [prompts, setPrompts] = useState<Prompt[]>([])
  const [current, setCurrent] = useState<Prompt | null>(null)
  const [mySubmitted, setMySubmitted] = useState(false)
  const [partnerStatus, setPartnerStatus] = useState<Status>('idle')
  const [revealed, setRevealed] = useState(false)
  const [answers, setAnswers] = useState<{ me?: Choice; her?: Choice }>({})
  const [tally, setTally] = useState<{ me: number; her: number }>({ me: 0, her: 0 })

  const currentRef = useRef<Prompt | null>(null)
  currentRef.current = current
  const mySubmittedRef = useRef(false)
  mySubmittedRef.current = mySubmitted

  const promptIds = useCallback(() => prompts.map((p) => p.id), [prompts])

  // Load prompts once.
  useEffect(() => {
    supabase
      .from('prompts')
      .select('*')
      .eq('category', 'never_have_i_ever')
      .order('id')
      .then(({ data }) => {
        if (data) setPrompts(data as Prompt[])
      })
  }, [])

  // Running tally = count of "I have" answers per person across all NHIE prompts.
  const recomputeTally = useCallback(async () => {
    const ids = prompts.map((p) => p.id)
    if (ids.length === 0) return
    const { data } = await supabase
      .from('answers')
      .select('sender, body')
      .eq('room_id', session.roomCode)
      .in('prompt_id', ids)
    if (!data) return
    setTally({
      me: data.filter((a) => a.sender === 'me' && a.body === 'have').length,
      her: data.filter((a) => a.sender === 'her' && a.body === 'have').length,
    })
  }, [prompts, session.roomCode])

  useEffect(() => {
    recomputeTally()
  }, [recomputeTally])

  const reveal = useCallback(
    async (prompt: Prompt) => {
      const { data } = await supabase
        .from('answers')
        .select('sender, body')
        .eq('room_id', session.roomCode)
        .eq('prompt_id', prompt.id)
      if (!data) return
      const map: { me?: Choice; her?: Choice } = {}
      for (const r of data) map[r.sender as Identity] = r.body as Choice
      setAnswers(map)
      setRevealed(true)
      recomputeTally()
    },
    [session.roomCode, recomputeTally],
  )

  const resetLocal = useCallback(() => {
    setMySubmitted(false)
    setPartnerStatus('idle')
    setRevealed(false)
    setAnswers({})
  }, [])

  // Channel subscriptions.
  useEffect(() => {
    const offPrompt = on('nhie:prompt', (p) => {
      const { promptId } = p as { promptId: string }
      const prompt = prompts.find((x) => x.id === promptId)
      if (prompt) {
        resetLocal()
        setCurrent(prompt)
      }
    })
    const offAnswer = on('nhie:answer', (p) => {
      if ((p as { sender: Identity }).sender !== partnerId) return
      setPartnerStatus('submitted')
      const prompt = currentRef.current
      if (prompt && mySubmittedRef.current) reveal(prompt)
    })
    const offReset = on('nhie:reset', () => {
      resetLocal()
      setCurrent(null)
      setTally({ me: 0, her: 0 })
    })
    return () => {
      offPrompt()
      offAnswer()
      offReset()
    }
  }, [on, prompts, partnerId, reveal, resetLocal])

  async function pickNewQuestion() {
    if (prompts.length === 0) return
    // Don't repeat statements already answered this round (until Reset).
    const { data } = await supabase
      .from('answers')
      .select('prompt_id')
      .eq('room_id', session.roomCode)
      .is('day_key', null)
    const seen = new Set((data ?? []).map((r) => r.prompt_id as string))
    let pool = prompts.filter((p) => !seen.has(p.id) && p.id !== current?.id)
    const exhausted = pool.length === 0
    if (exhausted) pool = prompts.filter((p) => p.id !== current?.id)
    if (pool.length === 0) pool = prompts
    const next = pool[Math.floor(Math.random() * pool.length)]
    if (exhausted) {
      await supabase
        .from('answers')
        .delete()
        .eq('room_id', session.roomCode)
        .eq('prompt_id', next.id)
    }
    resetLocal()
    setCurrent(next)
    broadcast('nhie:prompt', { promptId: next.id })
  }

  async function submit(choice: Choice) {
    const prompt = current
    if (!prompt || mySubmitted) return
    setMySubmitted(true)
    await supabase.from('answers').insert({
      room_id: session.roomCode,
      prompt_id: prompt.id,
      sender: session.identity,
      body: choice,
      revealed: false,
    })
    broadcast('nhie:answer', { sender: session.identity })
    if (partnerStatus === 'submitted') reveal(prompt)
  }

  function resetGame() {
    // Tally isn't a competition — save the scoreboard with no winner.
    saveGameMemory(session, broadcast, 'Never Have I Ever', tally, null)
    resetLocal()
    setCurrent(null)
    setTally({ me: 0, her: 0 })
    broadcast('nhie:reset', {})
    supabase
      .from('answers')
      .delete()
      .eq('room_id', session.roomCode)
      .in('prompt_id', promptIds())
      .then(() => {})
  }

  const partnerName = labelForIdentity(partnerId)
  const label = (c?: Choice) =>
    c === 'have' ? 'I have 💗' : c === 'havent' ? "I haven't" : '—'

  return (
    <div className="rounded-2xl bg-paper ring-1 ring-ink/10 shadow-sm p-6 flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-stone-800">
          🙈 Never Have I Ever
        </h2>
        <div className="flex items-center gap-3 text-sm">
          <span className="rounded-full bg-seal-100 text-seal-700 px-3 py-1 font-medium">
            {labelForIdentity('me')} {tally.me}
          </span>
          <span className="rounded-full bg-gold-100 text-gold-700 px-3 py-1 font-medium">
            {labelForIdentity('her')} {tally.her}
          </span>
          <ResetButton
            label="Finish game"
            confirm="Finish this round of Never Have I Ever? The tally is saved to Memories, then it resets for both of you."
            onReset={resetGame}
          />
        </div>
      </div>

      <p className="text-xs text-stone-400 -mt-3">
        Tally counts how many things each of you has done.
      </p>

      {!current ? (
        <div className="text-center py-6">
          <p className="text-stone-500 mb-4">
            A statement appears — you both tap “I have” or “I haven’t,” then see
            each other’s answers.
          </p>
          <button
            type="button"
            onClick={pickNewQuestion}
            className="rounded-xl bg-seal-500 text-white px-5 py-2.5 font-medium hover:bg-seal-600"
          >
            Start
          </button>
        </div>
      ) : (
        <>
          <div className="rounded-2xl bg-stone-50 p-5 text-center">
            <div className="text-xs uppercase tracking-wide text-stone-400 mb-1">
              Never have I ever…
            </div>
            <p className="text-lg text-stone-800">{current.text}</p>
          </div>

          <p className="text-sm text-stone-500 h-5 text-center">
            {partnerStatus === 'answering' && `${partnerName} is deciding…`}
            {partnerStatus === 'submitted' &&
              !revealed &&
              `${partnerName} has answered ✓`}
          </p>

          {!revealed ? (
            mySubmitted ? (
              <p className="text-stone-500 italic text-center">
                Locked in — waiting for {partnerName}…
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => submit('have')}
                  className="rounded-2xl border-2 border-seal-200 hover:border-seal-400 hover:bg-seal-50 p-5 text-lg font-medium text-seal-700 transition"
                >
                  I have 💗
                </button>
                <button
                  type="button"
                  onClick={() => submit('havent')}
                  className="rounded-2xl border-2 border-stone-200 hover:border-stone-400 hover:bg-stone-50 p-5 text-lg font-medium text-stone-600 transition"
                >
                  I haven’t
                </button>
              </div>
            )
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border-2 border-seal-200 bg-seal-50 p-4 text-center">
                  <div className="text-xs font-medium text-stone-500 mb-1">
                    You
                  </div>
                  <div className="text-stone-800 text-lg">
                    {label(session.identity === 'me' ? answers.me : answers.her)}
                  </div>
                </div>
                <div className="rounded-2xl border-2 border-gold-200 bg-gold-50 p-4 text-center">
                  <div className="text-xs font-medium text-stone-500 mb-1">
                    {partnerName}
                  </div>
                  <div className="text-stone-800 text-lg">
                    {label(partnerId === 'me' ? answers.me : answers.her)}
                  </div>
                </div>
              </div>
              {answers.me === answers.her && (
                <p className="text-center text-green-600 font-medium">
                  Same answer! 😄
                </p>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={pickNewQuestion}
            className="self-center text-sm text-seal-600 hover:text-seal-700 font-medium"
          >
            Next one →
          </button>
        </>
      )}
    </div>
  )
}
