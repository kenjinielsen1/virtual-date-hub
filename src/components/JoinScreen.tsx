import { useState } from 'react'
import type { Identity, Session } from '../lib/session'
import { labelForIdentity, normalizeRoomCode } from '../lib/session'

interface JoinScreenProps {
  onJoin: (session: Session) => void
}

export function JoinScreen({ onJoin }: JoinScreenProps) {
  const [roomCode, setRoomCode] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [identity, setIdentity] = useState<Identity>('me')
  const [error, setError] = useState('')

  // Plain click handler — no <form> submit, so no page refresh.
  function handleJoin() {
    const code = normalizeRoomCode(roomCode)
    if (!code) {
      setError('Pick a room code you both agree on.')
      return
    }
    onJoin({
      roomCode: code,
      identity,
      displayName: displayName.trim() || labelForIdentity(identity),
    })
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleJoin()
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-paper shadow-[0_12px_40px_rgba(43,35,32,0.14)] ring-1 ring-ink/15 p-8 relative">
        {/* Postage-stamp corner */}
        <div className="absolute top-4 right-4 w-12 h-14 rounded-sm border-2 border-dashed border-ink/15 flex items-center justify-center text-2xl rotate-3">
          💌
        </div>
        <div className="text-center mb-8">
          <p className="font-script text-2xl text-seal-600 -mb-1">for the two of us</p>
          <h1 className="text-3xl text-ink">Virtual Date Hub</h1>
          <div className="flex items-center justify-center gap-2 mt-3 text-ink/30">
            <span className="h-px w-10 bg-ink/20" />
            <span className="text-xs">✶</span>
            <span className="h-px w-10 bg-ink/20" />
          </div>
          <p className="text-stone-500 mt-3 text-sm">
            Enter the same room code to meet in your room.
          </p>
        </div>

        <label className="block text-sm font-medium text-stone-600 mb-1">
          Room code
        </label>
        <input
          value={roomCode}
          onChange={(e) => {
            setRoomCode(e.target.value)
            setError('')
          }}
          onKeyDown={handleKeyDown}
          placeholder="e.g. sunset-cafe"
          autoFocus
          className="w-full rounded-xl border border-stone-200 px-4 py-3 mb-4 outline-none focus:ring-2 focus:ring-seal-300"
        />

        <label className="block text-sm font-medium text-stone-600 mb-1">
          Your name
        </label>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Optional"
          className="w-full rounded-xl border border-stone-200 px-4 py-3 mb-4 outline-none focus:ring-2 focus:ring-seal-300"
        />

        <label className="block text-sm font-medium text-stone-600 mb-1">
          I'm joining as
        </label>
        <div className="grid grid-cols-2 gap-3 mb-6">
          {(['me', 'her'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setIdentity(option)}
              className={`rounded-xl px-4 py-3 font-medium transition ${
                identity === option
                  ? 'bg-seal-500 text-white shadow'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              {labelForIdentity(option)}
            </button>
          ))}
        </div>

        {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

        <button
          type="button"
          onClick={handleJoin}
          className="w-full rounded-xl bg-seal-600 text-cream font-medium tracking-wide py-3 shadow-md hover:bg-seal-700 transition"
        >
          Seal &amp; enter ✉
        </button>

        <p className="text-xs text-stone-400 text-center mt-4">
          Share the room code with your partner so you both land in the same
          place.
        </p>
      </div>
    </div>
  )
}
