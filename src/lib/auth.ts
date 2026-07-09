import { supabase } from './supabase'
import {
  labelForIdentity,
  type Identity,
  type Session,
} from './session'

// Master flag. While OFF (default everywhere, incl. Vercel), the app uses the
// existing room-code join and none of this runs. Flipped ON only at cutover.
export function authEnabled(): boolean {
  return import.meta.env.VITE_AUTH_ENABLED === 'true'
}

// Send a 6-digit code (and link) to the email.
export async function sendCode(email: string) {
  return supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { shouldCreateUser: true },
  })
}

// Verify the typed 6-digit code → establishes the session.
export async function verifyCode(email: string, token: string) {
  return supabase.auth.verifyOtp({
    email: email.trim(),
    token: token.trim(),
    type: 'email',
  })
}

export async function signOut() {
  await supabase.auth.signOut()
}

// After sign-in: which room + identity is this user a member of (if any)?
export async function getMembershipSession(): Promise<Session | null> {
  const { data } = await supabase
    .from('room_members')
    .select('room_id, identity')
    .limit(1)
    .maybeSingle()
  if (!data) return null
  const identity = data.identity as Identity
  return {
    roomCode: data.room_id as string,
    identity,
    displayName: labelForIdentity(identity),
  }
}

// One-time join with a room code + identity (server-enforced 2-person cap).
export async function joinRoom(
  roomCode: string,
  identity: Identity,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { error } = await supabase.rpc('join_room', {
    p_room_id: roomCode.trim(),
    p_identity: identity,
  })
  if (error) return { ok: false, reason: error.message }
  return { ok: true }
}
