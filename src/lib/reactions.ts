import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useRoomChannel } from './RoomChannel'
import type { Session } from './session'

export interface Reaction {
  id: string
  room_id: string
  target_type: string
  target_id: string
  emoji: string
  reacted_by: string
  created_at: string
}

// One hook per surface: loads the room's reactions once, stays live via the
// shared channel, and toggles (tap adds, tap again removes — the dedupe rule).
export function useReactions(session: Session) {
  const { broadcast, on } = useRoomChannel()
  const [rows, setRows] = useState<Reaction[]>([])

  useEffect(() => {
    let cancelled = false
    supabase
      .from('reactions')
      .select('*')
      .eq('room_id', session.roomCode)
      .then(({ data }) => {
        if (cancelled || !data) return
        setRows((prev) => {
          const byId = new Map(prev.map((r) => [r.id, r]))
          for (const r of data as Reaction[]) if (!byId.has(r.id)) byId.set(r.id, r)
          return [...byId.values()]
        })
      })
    return () => {
      cancelled = true
    }
  }, [session.roomCode])

  useEffect(() => {
    const offAdd = on('reaction:add', (p) => {
      const r = p as Reaction
      setRows((prev) => (prev.some((x) => x.id === r.id) ? prev : [...prev, r]))
    })
    const offRemove = on('reaction:remove', (p) => {
      const { id } = p as { id: string }
      setRows((prev) => prev.filter((r) => r.id !== id))
    })
    return () => {
      offAdd()
      offRemove()
    }
  }, [on])

  const toggle = useCallback(
    async (target_type: string, target_id: string, emoji: string) => {
      const mine = rows.find(
        (r) =>
          r.target_type === target_type &&
          r.target_id === target_id &&
          r.emoji === emoji &&
          r.reacted_by === session.identity,
      )
      if (mine) {
        setRows((prev) => prev.filter((r) => r.id !== mine.id))
        broadcast('reaction:remove', { id: mine.id })
        await supabase.from('reactions').delete().eq('id', mine.id)
      } else {
        const row: Reaction = {
          id: crypto.randomUUID(),
          room_id: session.roomCode,
          target_type,
          target_id,
          emoji,
          reacted_by: session.identity,
          created_at: new Date().toISOString(),
        }
        setRows((prev) => [...prev, row])
        broadcast('reaction:add', row)
        await supabase.from('reactions').insert({
          id: row.id,
          room_id: row.room_id,
          target_type,
          target_id,
          emoji,
          reacted_by: row.reacted_by,
        })
      }
    },
    [rows, session, broadcast],
  )

  const reactionsFor = useCallback(
    (target_type: string, target_id: string) =>
      rows.filter(
        (r) => r.target_type === target_type && r.target_id === target_id,
      ),
    [rows],
  )

  return { reactionsFor, toggle }
}
