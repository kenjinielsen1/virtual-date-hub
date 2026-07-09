import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  getMembershipSession,
  joinRoom,
  sendCode,
  signOut,
  verifyCode,
} from '../lib/auth'
import {
  labelForIdentity,
  normalizeRoomCode,
  type Identity,
  type Session,
} from '../lib/session'

// Renders the sign-in → join flow and hands a ready Session up to App.
// Only mounted when VITE_AUTH_ENABLED === 'true'.
export function AuthGate({ onSession }: { onSession: (s: Session) => void }) {
  const [phase, setPhase] = useState<'loading' | 'email' | 'code' | 'join'>(
    'loading',
  )
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [identity, setIdentity] = useState<Identity>('me')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // On mount / auth change: if signed in, look for membership → app, else join.
  useEffect(() => {
    let active = true
    async function resolve() {
      const { data } = await supabase.auth.getSession()
      if (!active) return
      if (!data.session) {
        setPhase('email')
        return
      }
      const s = await getMembershipSession()
      if (!active) return
      if (s) onSession(s)
      else setPhase('join')
    }
    resolve()
    const { data: sub } = supabase.auth.onAuthStateChange(() => resolve())
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [onSession])

  async function handleSendCode() {
    if (!email.trim()) return
    setBusy(true)
    setError('')
    const { error } = await sendCode(email)
    setBusy(false)
    if (error) setError(error.message)
    else setPhase('code')
  }

  async function handleVerify() {
    setBusy(true)
    setError('')
    const { error } = await verifyCode(email, code)
    setBusy(false)
    if (error) setError('That code didn’t work — check it and try again.')
    // success → onAuthStateChange fires → resolve() routes onward
  }

  async function handleJoin() {
    const rc = normalizeRoomCode(roomCode)
    if (!rc) {
      setError('Enter the room code you two agreed on.')
      return
    }
    setBusy(true)
    setError('')
    const r = await joinRoom(rc, identity)
    if (!r.ok) {
      setBusy(false)
      setError(r.reason)
      return
    }
    const s = await getMembershipSession()
    setBusy(false)
    if (s) onSession(s)
    else setError('Joined, but couldn’t load the room. Try refreshing.')
  }

  const card =
    'w-full max-w-md rounded-2xl bg-paper shadow-[0_12px_40px_rgba(43,35,32,0.14)] ring-1 ring-ink/15 p-8'
  const input =
    'w-full rounded-xl border border-stone-200 px-4 py-3 mb-4 outline-none focus:ring-2 focus:ring-seal-300'
  const primary =
    'w-full rounded-xl bg-seal-600 text-cream font-medium tracking-wide py-3 shadow-md hover:bg-seal-700 transition disabled:opacity-50'

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className={card}>
        <div className="text-center mb-6">
          <p className="font-script text-2xl text-seal-600 -mb-1">
            for the two of us
          </p>
          <h1 className="text-3xl text-ink">Virtual Date Hub</h1>
        </div>

        {phase === 'loading' && (
          <p className="text-center text-stone-400">Loading…</p>
        )}

        {phase === 'email' && (
          <>
            <label className="block text-sm font-medium text-stone-600 mb-1">
              Your email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                setError('')
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleSendCode()}
              placeholder="you@email.com"
              autoFocus
              className={input}
            />
            <button
              type="button"
              onClick={handleSendCode}
              disabled={busy}
              className={primary}
            >
              {busy ? 'Sending…' : 'Email me a code ✉'}
            </button>
            <p className="text-xs text-stone-400 text-center mt-3">
              We’ll email a 6-digit code — no password.
            </p>
          </>
        )}

        {phase === 'code' && (
          <>
            <label className="block text-sm font-medium text-stone-600 mb-1">
              Code sent to {email}
            </label>
            <input
              inputMode="numeric"
              value={code}
              onChange={(e) => {
                setCode(e.target.value)
                setError('')
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
              placeholder="123456"
              autoFocus
              className={input + ' tracking-[0.4em] text-center text-lg'}
            />
            <button
              type="button"
              onClick={handleVerify}
              disabled={busy}
              className={primary}
            >
              {busy ? 'Checking…' : 'Sign in'}
            </button>
            <button
              type="button"
              onClick={() => setPhase('email')}
              className="w-full text-xs text-stone-400 hover:text-stone-600 mt-3"
            >
              use a different email
            </button>
          </>
        )}

        {phase === 'join' && (
          <>
            <p className="text-sm text-stone-500 mb-4 text-center">
              Signed in! Enter your shared room code once to join.
            </p>
            <label className="block text-sm font-medium text-stone-600 mb-1">
              Room code
            </label>
            <input
              value={roomCode}
              onChange={(e) => {
                setRoomCode(e.target.value)
                setError('')
              }}
              placeholder="the code you both agreed on"
              className={input}
            />
            <label className="block text-sm font-medium text-stone-600 mb-1">
              I’m joining as
            </label>
            <div className="grid grid-cols-2 gap-3 mb-5">
              {(['me', 'her'] as const).map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setIdentity(o)}
                  className={`rounded-xl px-4 py-3 font-medium transition ${
                    identity === o
                      ? 'bg-seal-500 text-white shadow'
                      : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                  }`}
                >
                  {labelForIdentity(o)}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={handleJoin}
              disabled={busy}
              className={primary}
            >
              {busy ? 'Joining…' : 'Join room ♡'}
            </button>
            <button
              type="button"
              onClick={() => signOut()}
              className="w-full text-xs text-stone-400 hover:text-stone-600 mt-3"
            >
              sign out
            </button>
          </>
        )}

        {error && <p className="text-sm text-red-500 mt-3">{error}</p>}
      </div>
    </div>
  )
}
