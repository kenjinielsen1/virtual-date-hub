import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Identity, Session } from './session'

// One Realtime channel per room, shared by every feature (presence, chat,
// watch party, trivia, ...). We namespace payloads by an `event` name so
// features don't collide.

type BroadcastHandler = (payload: unknown) => void

interface RoomChannelValue {
  partnerOnline: boolean
  // Fire a broadcast event on the shared channel.
  broadcast: (event: string, payload: unknown) => void
  // Subscribe to a broadcast event; returns an unsubscribe fn.
  on: (event: string, handler: BroadcastHandler) => () => void
}

const RoomChannelContext = createContext<RoomChannelValue | null>(null)

export function RoomChannelProvider({
  session,
  children,
}: {
  session: Session
  children: ReactNode
}) {
  const [partnerOnline, setPartnerOnline] = useState(false)
  const channelRef = useRef<RealtimeChannel | null>(null)
  // Map of event name -> set of handlers. We keep our own registry so multiple
  // components can listen to the same broadcast event on the one channel.
  const handlersRef = useRef<Map<string, Set<BroadcastHandler>>>(new Map())

  useEffect(() => {
    const channel = supabase.channel(`room:${session.roomCode}`, {
      config: { presence: { key: session.identity } },
    })
    channelRef.current = channel

    // Presence: partner is online if any presence key !== our own identity.
    const recomputePresence = () => {
      const state = channel.presenceState<{ identity: Identity }>()
      const others = Object.keys(state).filter((k) => k !== session.identity)
      setPartnerOnline(others.length > 0)
    }
    channel.on('presence', { event: 'sync' }, recomputePresence)
    channel.on('presence', { event: 'join' }, recomputePresence)
    channel.on('presence', { event: 'leave' }, recomputePresence)

    // A single broadcast listener fans out to registered handlers by event.
    channel.on('broadcast', { event: '*' }, (msg) => {
      const set = handlersRef.current.get(msg.event)
      if (set) set.forEach((h) => h(msg.payload))
    })

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        channel.track({
          identity: session.identity,
          name: session.displayName,
          at: Date.now(),
        })
      }
    })

    return () => {
      supabase.removeChannel(channel)
      channelRef.current = null
    }
  }, [session.roomCode, session.identity, session.displayName])

  const value = useMemo<RoomChannelValue>(
    () => ({
      partnerOnline,
      broadcast: (event, payload) => {
        channelRef.current?.send({ type: 'broadcast', event, payload })
      },
      on: (event, handler) => {
        const map = handlersRef.current
        if (!map.has(event)) map.set(event, new Set())
        map.get(event)!.add(handler)
        return () => {
          map.get(event)?.delete(handler)
        }
      },
    }),
    [partnerOnline],
  )

  return (
    <RoomChannelContext.Provider value={value}>
      {children}
    </RoomChannelContext.Provider>
  )
}

export function useRoomChannel() {
  const ctx = useContext(RoomChannelContext)
  if (!ctx)
    throw new Error('useRoomChannel must be used inside RoomChannelProvider')
  return ctx
}
