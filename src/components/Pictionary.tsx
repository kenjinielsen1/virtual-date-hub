import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useRoomChannel } from '../lib/RoomChannel'
import { labelForIdentity, type Identity, type Session } from '../lib/session'
import { DrawCanvas } from './DrawCanvas'
import { Chat } from './Chat'
import { ResetButton } from './ResetButton'
import { saveGameMemory } from '../lib/memories'

const ROUND_SECONDS = 90

// Used if the pictionary_words table isn't seeded yet (migration 0004).
const FALLBACK_WORDS = [
  'cat', 'dog', 'house', 'sun', 'moon', 'star', 'tree', 'flower', 'heart',
  'pizza', 'cake', 'coffee', 'car', 'boat', 'rainbow', 'beach', 'book',
  'guitar', 'balloon', 'ice cream', 'snowman', 'umbrella', 'fish',
  'butterfly', 'rocket', 'robot', 'ghost', 'crown', 'clock', 'key', 'gift',
  'cloud', 'kite', 'apple', 'banana', 'hat', 'glasses', 'ring', 'penguin',
  'cactus',
]

interface PictState {
  roundId: string
  drawer: Identity
  word: string
  startedAt: number
  active: boolean
  revealed: boolean
  winner: Identity | null
  scores: { me: number; her: number }
}

function normalize(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

function other(id: Identity): Identity {
  return id === 'me' ? 'her' : 'me'
}

export function Pictionary({ session }: { session: Session }) {
  const { broadcast, on } = useRoomChannel()
  const [words, setWords] = useState<string[]>(FALLBACK_WORDS)
  const [state, setState] = useState<PictState | null>(null)
  const [remaining, setRemaining] = useState(ROUND_SECONDS)

  const stateRef = useRef<PictState | null>(null)
  stateRef.current = state

  const iAmDrawer = state?.drawer === session.identity
  const scores = state?.scores ?? { me: 0, her: 0 }

  // Load words + restore any in-progress game.
  useEffect(() => {
    supabase
      .from('pictionary_words')
      .select('word')
      .then(({ data }) => {
        if (data && data.length) setWords(data.map((w) => w.word as string))
      })
    supabase
      .from('room_state')
      .select('pictionary')
      .eq('room_id', session.roomCode)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.pictionary) setState(data.pictionary as PictState)
      })
  }, [session.roomCode])

  const pushState = useCallback(
    (next: PictState) => {
      setState(next)
      broadcast('pict:state', next)
      supabase
        .from('room_state')
        .upsert({ room_id: session.roomCode, pictionary: next })
        .then(() => {})
    },
    [broadcast, session.roomCode],
  )

  // End the current round (only the drawer, who knows the word, is authority).
  const endRound = useCallback(
    (winner: Identity | null) => {
      const s = stateRef.current
      if (!s || !s.active) return
      const scores = { ...s.scores }
      if (winner) scores[winner] += 1
      pushState({ ...s, active: false, revealed: true, winner, scores })
    },
    [pushState],
  )

  function startRound(drawer: Identity) {
    if (words.length === 0) return
    const word = words[Math.floor(Math.random() * words.length)]
    pushState({
      roundId: crypto.randomUUID(),
      drawer,
      word,
      startedAt: Date.now(),
      active: true,
      revealed: false,
      winner: null,
      scores: stateRef.current?.scores ?? { me: 0, her: 0 },
    })
  }

  // Receive game state / reset from partner.
  useEffect(() => {
    const offState = on('pict:state', (p) => setState(p as PictState))
    const offReset = on('pict:reset', () => setState(null))
    return () => {
      offState()
      offReset()
    }
  }, [on])

  function resetGame() {
    const s = stateRef.current?.scores
    if (s)
      saveGameMemory(
        session,
        broadcast,
        'Pictionary',
        s,
        s.me > s.her ? 'me' : s.her > s.me ? 'her' : null,
      )
    setState(null)
    broadcast('pict:reset', {})
    supabase
      .from('room_state')
      .upsert({ room_id: session.roomCode, pictionary: null })
      .then(() => {})
  }

  // Drawer listens to chat guesses and detects a correct one.
  useEffect(() => {
    return on('chat', (p) => {
      const msg = p as { sender: Identity; body: string }
      const s = stateRef.current
      if (!s || !s.active || s.revealed) return
      if (s.drawer !== session.identity) return // only the drawer scores
      if (msg.sender === s.drawer) return
      if (normalize(msg.body).includes(normalize(s.word))) endRound(msg.sender)
    })
  }, [on, session.identity, endRound])

  // Countdown timer; the drawer triggers timeout end.
  useEffect(() => {
    if (!state?.active) {
      setRemaining(ROUND_SECONDS)
      return
    }
    const tick = () => {
      const left = Math.max(
        0,
        ROUND_SECONDS - Math.floor((Date.now() - state.startedAt) / 1000),
      )
      setRemaining(left)
      if (left === 0 && state.drawer === session.identity) endRound(null)
    }
    tick()
    const id = window.setInterval(tick, 500)
    return () => window.clearInterval(id)
  }, [state?.active, state?.startedAt, state?.drawer, session.identity, endRound])

  const drawerName = state ? labelForIdentity(state.drawer) : ''
  const guesserName = state ? labelForIdentity(other(state.drawer)) : ''

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl bg-paper ring-1 ring-ink/10 shadow-sm p-6 flex flex-col gap-4">
        {/* Header: scores + timer */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-lg font-semibold text-stone-800">✏️ Pictionary</h2>
          <div className="flex items-center gap-3 text-sm">
            <span className="rounded-full bg-seal-100 text-seal-700 px-3 py-1 font-medium">
              {labelForIdentity('me')} {scores.me}
            </span>
            <span className="rounded-full bg-gold-100 text-gold-700 px-3 py-1 font-medium">
              {labelForIdentity('her')} {scores.her}
            </span>
            {state?.active && (
              <span
                className={`rounded-full px-3 py-1 font-semibold tabular-nums ${
                  remaining <= 10
                    ? 'bg-red-100 text-red-600'
                    : 'bg-stone-100 text-stone-600'
                }`}
              >
                {remaining}s
              </span>
            )}
            <ResetButton
              label="Finish game"
              confirm="Finish Pictionary? The final score is saved to Memories, then it resets for both of you."
              onReset={resetGame}
            />
          </div>
        </div>

        {/* Status / word / controls */}
        {!state || (!state.active && !state.revealed) ? (
          <div className="text-center py-4">
            <p className="text-stone-500 mb-3">
              One of you draws a secret word, the other guesses in the chat.
              Correct guess = a point, then you swap!
            </p>
            <button
              type="button"
              onClick={() => startRound(session.identity)}
              className="rounded-xl bg-seal-500 text-white px-5 py-2.5 font-medium hover:bg-seal-600"
            >
              Start a round (you draw)
            </button>
          </div>
        ) : state.active ? (
          <div className="rounded-2xl bg-stone-50 p-4 text-center">
            {iAmDrawer ? (
              <p className="text-stone-700">
                ✏️ You’re drawing:{' '}
                <span className="font-bold text-seal-600 text-lg">
                  {state.word}
                </span>
              </p>
            ) : (
              <p className="text-stone-700">
                🤔 {drawerName} is drawing — type your guess in the chat!
              </p>
            )}
          </div>
        ) : (
          // Revealed
          <div className="rounded-2xl bg-stone-50 p-4 text-center space-y-2">
            <p className="text-stone-700">
              The word was{' '}
              <span className="font-bold text-stone-900">{state.word}</span>
            </p>
            <p className="font-semibold">
              {state.winner ? (
                <span className="text-green-600">
                  🎉 {labelForIdentity(state.winner)} guessed it! +1
                </span>
              ) : (
                <span className="text-stone-500">⏰ Time’s up — nobody got it</span>
              )}
            </p>
            <button
              type="button"
              onClick={() => startRound(other(state.drawer))}
              className="rounded-xl bg-seal-500 text-white px-5 py-2 font-medium hover:bg-seal-600"
            >
              Next round ({guesserName} draws)
            </button>
          </div>
        )}
      </div>

      {/* Canvas — drawable only for the drawer during an active round. */}
      <DrawCanvas
        session={session}
        readOnly={!(state?.active && iAmDrawer)}
        clearKey={state?.roundId}
      />

      {/* Guessing happens in chat. */}
      <div className="rounded-2xl bg-paper ring-1 ring-ink/10 shadow-sm p-4 flex flex-col h-96">
        <h3 className="text-sm font-semibold text-stone-600 mb-2 px-1">
          Guesses
        </h3>
        <div className="flex-1 min-h-0">
          <Chat session={session} />
        </div>
      </div>
    </div>
  )
}
