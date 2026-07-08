import { supabase } from './supabase'
import type { Session } from './session'

// Save a finished game's scoreboard as a memory and live-update the partner's
// feed. Called by whoever ends the game (single writer — no duplicate rows).
export async function saveGameMemory(
  session: Session,
  broadcast: (event: string, payload: unknown) => void,
  game: string,
  scores: { me: number; her: number },
  winner: 'me' | 'her' | null,
) {
  if ((scores.me ?? 0) + (scores.her ?? 0) <= 0) return // nothing was played
  const { data, error } = await supabase
    .from('memories')
    .insert({
      room_id: session.roomCode,
      kind: 'game',
      title: game,
      data: { game, scores, winner },
      created_by: session.identity,
    })
    .select()
    .single()
  if (!error && data) broadcast('memory:new', data)
}
