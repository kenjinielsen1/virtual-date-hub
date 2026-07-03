import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useRoomChannel } from '../lib/RoomChannel'
import type { Session } from '../lib/session'
import { ResetButton } from './ResetButton'

interface Step {
  text: string
  timerSeconds?: number
}
interface Recipe {
  id: string
  emoji: string
  title: string
  servings: string
  ingredients: string[]
  steps: Step[]
}

// Synced across both cooks.
interface CookState {
  recipeId: string
  step: number
  timerStartedAt: number | null // ms; the timer belongs to the current step
}

const RECIPES: Recipe[] = [
  {
    id: 'garlic-pasta',
    emoji: '🍝',
    title: 'Garlic Butter Pasta',
    servings: 'for 2',
    ingredients: [
      '200g spaghetti',
      '3 tbsp butter',
      '4 cloves garlic, minced',
      'Parmesan, grated',
      'Salt & pepper',
      'Fresh parsley',
    ],
    steps: [
      { text: 'Bring a pot of salted water to a boil.' },
      { text: 'Cook the spaghetti until al dente.', timerSeconds: 600 },
      { text: 'Meanwhile, melt butter in a pan over low heat.' },
      { text: 'Add garlic and cook until fragrant.', timerSeconds: 120 },
      { text: 'Drain pasta (save a splash of pasta water), toss into the pan.' },
      { text: 'Add Parmesan + a splash of pasta water; toss to coat.' },
      { text: 'Season, top with parsley, and plate together. 🍝' },
    ],
  },
  {
    id: 'pancakes',
    emoji: '🥞',
    title: 'Fluffy Pancakes',
    servings: 'for 2',
    ingredients: [
      '1 cup flour',
      '1 tbsp sugar',
      '1 tsp baking powder',
      'Pinch of salt',
      '1 cup milk',
      '1 egg',
      '2 tbsp melted butter',
    ],
    steps: [
      { text: 'Whisk flour, sugar, baking powder, and salt.' },
      { text: 'In another bowl, whisk milk, egg, and melted butter.' },
      { text: 'Combine wet and dry — don’t overmix, lumps are okay.' },
      { text: 'Let the batter rest.', timerSeconds: 300 },
      { text: 'Heat a greased pan over medium.' },
      { text: 'Pour batter; cook until bubbly, then flip.', timerSeconds: 120 },
      { text: 'Stack, add toppings, and dig in together. 🥞' },
    ],
  },
  {
    id: 'tacos',
    emoji: '🌮',
    title: 'Weeknight Tacos',
    servings: 'for 2',
    ingredients: [
      '300g ground beef or beans',
      '1 packet taco seasoning',
      'Tortillas',
      'Lettuce, shredded',
      'Tomato, diced',
      'Cheese, shredded',
      'Sour cream / hot sauce',
    ],
    steps: [
      { text: 'Heat a pan over medium-high.' },
      { text: 'Brown the beef (or warm the beans).', timerSeconds: 420 },
      { text: 'Add taco seasoning + a splash of water; stir.' },
      { text: 'Simmer until thickened.', timerSeconds: 300 },
      { text: 'Warm the tortillas.' },
      { text: 'Set out all the toppings.' },
      { text: 'Build your tacos and cheers. 🌮' },
    ],
  },
  {
    id: 'mug-brownies',
    emoji: '🍫',
    title: 'Two Mug Brownies',
    servings: 'one mug each',
    ingredients: [
      '4 tbsp flour (per mug)',
      '4 tbsp sugar',
      '2 tbsp cocoa powder',
      'Pinch of salt',
      '3 tbsp milk',
      '2 tbsp oil',
      'Chocolate chips',
    ],
    steps: [
      { text: 'Grab a mug each and cook in parallel!' },
      { text: 'Mix flour, sugar, cocoa, and salt in the mug.' },
      { text: 'Stir in milk and oil until smooth.' },
      { text: 'Drop in a few chocolate chips.' },
      { text: 'Microwave one mug at a time.', timerSeconds: 70 },
      { text: 'Let cool a minute, then eat together. 🍫' },
    ],
  },
]

function fmt(sec: number) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function CookAlong({ session }: { session: Session }) {
  const { broadcast, on } = useRoomChannel()
  const [state, setState] = useState<CookState | null>(null)
  const [now, setNow] = useState(Date.now())
  const stateRef = useRef<CookState | null>(null)
  stateRef.current = state

  // Restore synced state.
  useEffect(() => {
    supabase
      .from('room_state')
      .select('cook')
      .eq('room_id', session.roomCode)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.cook) setState(data.cook as CookState)
      })
  }, [session.roomCode])

  useEffect(() => {
    const offState = on('cook:state', (p) => setState(p as CookState))
    const offReset = on('cook:reset', () => setState(null))
    return () => {
      offState()
      offReset()
    }
  }, [on])

  // Tick for the countdown display.
  useEffect(() => {
    if (!state?.timerStartedAt) return
    const id = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(id)
  }, [state?.timerStartedAt])

  function pushState(next: CookState | null) {
    setState(next)
    if (next) {
      broadcast('cook:state', next)
      supabase
        .from('room_state')
        .upsert({ room_id: session.roomCode, cook: next })
        .then(() => {})
    }
  }

  function pickRecipe(id: string) {
    pushState({ recipeId: id, step: 0, timerStartedAt: null })
  }

  function goToStep(step: number) {
    if (!state) return
    pushState({ ...state, step, timerStartedAt: null })
  }

  function startTimer() {
    if (!state) return
    pushState({ ...state, timerStartedAt: Date.now() })
  }

  function resetCook() {
    setState(null)
    broadcast('cook:reset', {})
    supabase
      .from('room_state')
      .upsert({ room_id: session.roomCode, cook: null })
      .then(() => {})
  }

  const recipe = state ? RECIPES.find((r) => r.id === state.recipeId) : null

  // Recipe picker
  if (!state || !recipe) {
    return (
      <div className="rounded-2xl bg-paper ring-1 ring-ink/10 shadow-sm p-6">
        <h2 className="text-lg font-semibold text-stone-800 mb-1">
          👩‍🍳 Cook together
        </h2>
        <p className="text-stone-500 text-sm mb-4">
          Pick a recipe — you’ll both see the same steps and timers, and plate at
          the same time.
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          {RECIPES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => pickRecipe(r.id)}
              className="rounded-2xl border-2 border-stone-200 hover:border-seal-400 hover:bg-seal-50 p-4 text-left transition"
            >
              <div className="text-2xl">{r.emoji}</div>
              <div className="font-semibold text-stone-800">{r.title}</div>
              <div className="text-xs text-stone-400">
                {r.servings} · {r.steps.length} steps
              </div>
            </button>
          ))}
        </div>
      </div>
    )
  }

  const step = recipe.steps[state.step]
  const isLast = state.step === recipe.steps.length - 1
  const timerTotal = step.timerSeconds ?? 0
  const remaining = state.timerStartedAt
    ? Math.max(0, timerTotal - Math.floor((now - state.timerStartedAt) / 1000))
    : timerTotal
  const timerRunning = state.timerStartedAt != null && remaining > 0
  const timerDone = state.timerStartedAt != null && remaining === 0

  return (
    <div className="flex flex-col gap-4">
      {/* Header + ingredients */}
      <div className="rounded-2xl bg-paper ring-1 ring-ink/10 shadow-sm p-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-stone-800">
            {recipe.emoji} {recipe.title}
          </h2>
          <ResetButton
            label="Change recipe"
            confirm="Stop cooking this and pick a different recipe?"
            onReset={resetCook}
          />
        </div>
        <div className="text-xs uppercase tracking-wide text-stone-400 mb-1">
          Ingredients · {recipe.servings}
        </div>
        <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm text-stone-600 list-disc pl-5">
          {recipe.ingredients.map((ing) => (
            <li key={ing}>{ing}</li>
          ))}
        </ul>
      </div>

      {/* Current step */}
      <div className="rounded-2xl bg-paper ring-1 ring-ink/10 shadow-sm p-6 flex flex-col gap-4">
        <div className="text-sm text-stone-400">
          Step {state.step + 1} of {recipe.steps.length}
        </div>
        <p className="text-xl text-stone-800">{step.text}</p>

        {step.timerSeconds && (
          <div className="flex items-center gap-3">
            <span
              className={`text-3xl font-bold tabular-nums ${
                timerDone
                  ? 'text-green-600'
                  : remaining <= 10 && timerRunning
                    ? 'text-red-500'
                    : 'text-stone-700'
              }`}
            >
              {timerDone ? 'Done! ⏰' : fmt(remaining)}
            </span>
            {!state.timerStartedAt && (
              <button
                type="button"
                onClick={startTimer}
                className="rounded-xl bg-seal-500 text-white px-4 py-2 text-sm font-medium hover:bg-seal-600"
              >
                Start timer
              </button>
            )}
            {state.timerStartedAt && (
              <button
                type="button"
                onClick={startTimer}
                className="rounded-lg text-xs text-stone-400 hover:text-stone-600 px-2 py-1"
              >
                ↺ restart
              </button>
            )}
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={() => goToStep(state.step - 1)}
            disabled={state.step === 0}
            className="rounded-xl bg-stone-100 text-stone-600 px-4 py-2 font-medium disabled:opacity-40"
          >
            ← Back
          </button>
          {isLast ? (
            <span className="text-green-600 font-semibold">
              🎉 Enjoy your meal together!
            </span>
          ) : (
            <button
              type="button"
              onClick={() => goToStep(state.step + 1)}
              className="rounded-xl bg-seal-500 text-white px-5 py-2 font-medium hover:bg-seal-600"
            >
              Next step →
            </button>
          )}
        </div>
      </div>

      {/* Full step list */}
      <div className="rounded-2xl bg-paper ring-1 ring-ink/10 shadow-sm p-6">
        <ol className="space-y-2">
          {recipe.steps.map((s, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => goToStep(i)}
                className={`w-full text-left rounded-xl px-3 py-2 text-sm transition ${
                  i === state.step
                    ? 'bg-seal-50 text-seal-700 font-medium'
                    : i < state.step
                      ? 'text-stone-400 line-through'
                      : 'text-stone-600 hover:bg-stone-50'
                }`}
              >
                {i + 1}. {s.text}
                {s.timerSeconds ? ` (${fmt(s.timerSeconds)})` : ''}
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
