// Shared "who am I / what room am I in" state, persisted to localStorage so a
// page refresh doesn't kick you out.

export type Identity = 'me' | 'her'

// Display labels for each identity. The identity VALUES ('me' | 'her') stay
// fixed — they're keys in the DB, presence, and scores — but everything shown
// to the user goes through here, so renames are a one-line change.
export const IDENTITY_LABELS: Record<Identity, string> = {
  me: 'Mus',
  her: 'Cutie',
}

export function labelForIdentity(id: Identity): string {
  return IDENTITY_LABELS[id]
}

export interface Session {
  roomCode: string
  identity: Identity
  displayName: string
}

const STORAGE_KEY = 'vdh.session'

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Session
    if (!parsed.roomCode || !parsed.identity) return null
    return parsed
  } catch {
    return null
  }
}

export function saveSession(session: Session) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
}

export function clearSession() {
  localStorage.removeItem(STORAGE_KEY)
}

// Normalize room codes so "Sunset " and "sunset" land in the same room.
export function normalizeRoomCode(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '-')
}
