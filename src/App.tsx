import { useEffect, useState } from 'react'
import { JoinScreen } from './components/JoinScreen'
import { RoomShell } from './components/RoomShell'
import {
  clearSession,
  loadSession,
  saveSession,
  type Session,
} from './lib/session'
import { supabaseConfigured } from './lib/supabase'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)

  // Restore session from localStorage on first load so a refresh keeps us in.
  useEffect(() => {
    setSession(loadSession())
  }, [])

  function handleJoin(next: Session) {
    saveSession(next)
    setSession(next)
  }

  function handleLeave() {
    clearSession()
    setSession(null)
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
      ) : (
        <JoinScreen onJoin={handleJoin} />
      )}
    </>
  )
}
