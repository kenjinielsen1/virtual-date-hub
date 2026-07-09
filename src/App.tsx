import { useEffect, useState } from 'react'
import { JoinScreen } from './components/JoinScreen'
import { RoomShell } from './components/RoomShell'
import { AuthGate } from './components/AuthGate'
import {
  clearSession,
  loadSession,
  saveSession,
  type Session,
} from './lib/session'
import { authEnabled, signOut } from './lib/auth'
import { supabaseConfigured } from './lib/supabase'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)

  // Restore session from localStorage on first load so a refresh keeps us in.
  // In legacy (flag-off) mode, restore the code-based session from localStorage.
  // In auth mode, AuthGate resolves the session from Supabase Auth instead.
  useEffect(() => {
    if (!authEnabled()) setSession(loadSession())
  }, [])

  function handleJoin(next: Session) {
    saveSession(next)
    setSession(next)
  }

  function handleLeave() {
    if (authEnabled()) {
      signOut()
      setSession(null)
    } else {
      clearSession()
      setSession(null)
    }
  }

  return (
    <>
      {!supabaseConfigured && (
        <div className="bg-amber-100 text-amber-800 text-sm text-center py-2 px-4">
          Supabase env vars not set — copy <code>.env.example</code> to{' '}
          <code>.env</code> and add your project URL + anon key.
        </div>
      )}
      {session ? (
        <RoomShell session={session} onLeave={handleLeave} />
      ) : authEnabled() ? (
        <AuthGate onSession={setSession} />
      ) : (
        <JoinScreen onJoin={handleJoin} />
      )}
    </>
  )
}
