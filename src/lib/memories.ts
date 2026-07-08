import { supabase } from './supabase'
import type { Session } from './session'

// Star an answer or love note into memories. `sourceId` identifies the
// original item so we can show "already starred" and avoid duplicates.
export async function saveStarMemory(
  session: Session,
  broadcast: (event: string, payload: unknown) => void,
  kind: 'answer' | 'note',
  sourceId: string,
  data: Record<string, unknown>,
) {
  const { data: row, error } = await supabase
    .from('memories')
    .insert({
      room_id: session.roomCode,
      kind,
      data: { ...data, source_id: sourceId },
      created_by: session.identity,
    })
    .select()
    .single()
  if (!error && row) broadcast('memory:new', row)
  return !error
}

// Which items are already starred in this room (set of source_ids).
export async function loadStarredIds(roomCode: string): Promise<Set<string>> {
  const { data } = await supabase
    .from('memories')
    .select('data')
    .eq('room_id', roomCode)
    .in('kind', ['answer', 'note'])
  const ids = new Set<string>()
  for (const r of data ?? []) {
    const sid = (r.data as { source_id?: string })?.source_id
    if (sid) ids.add(sid)
  }
  return ids
}

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
