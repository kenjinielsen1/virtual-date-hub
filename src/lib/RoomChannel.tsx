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
import { notifyPartner, refreshPushSubscription } from './push'

// One Realtime channel per room, shared by every feature (presence, chat,
// watch party, trivia, ...). We namespace payloads by an `event` name so
// features don't collide.

type BroadcastHandler = (payload: unknown) => void

// Which broadcast events turn into a push for an OFFLINE partner, and how they
// read. `tag` groups notifications (a shared tag replaces the previous one);
// `throttleMs` limits noisy repeated events (steps, questions, ...).
const GAME_THROTTLE = 5 * 60 * 1000
interface NotifSpec {
  title: string
  body: string
  tag: string
  throttleMs: number
}
function buildNotif(
  event: string,
  payload: unknown,
  name: string,
): NotifSpec | null {
  const p = payload as { body?: string }
  switch (event) {
    case 'chat':
      return {
        title: `💬 ${name}`,
        body: typeof p?.body === 'string' ? p.body : 'sent a message',
        tag: 'chat',
        throttleMs: 0,
      }
    case 'note:new':
      return { title: '💌 A love note', body: `${name} left you a note`, tag: 'note', throttleMs: 0 }
    case 'watch:video':
      return { title: '🎬 Watch Party', body: `${name} started a watch party`, tag: 'watch', throttleMs: GAME_THROTTLE }
    case 'trivia:prompt':
      return { title: '💭 Trivia', body: `${name} wants to play trivia`, tag: 'game', throttleMs: GAME_THROTTLE }
    case 'nhie:prompt':
      return { title: '🙈 Never Have I Ever', body: `${name} wants to play`, tag: 'game', throttleMs: GAME_THROTTLE }
    case 'pict:state':
      return { title: '✏️ Pictionary', body: `${name} started Pictionary`, tag: 'game', throttleMs: GAME_THROTTLE }
    case 'cook:state':
      return { title: '👩‍🍳 Cook Along', body: `${name} started cooking`, tag: 'game', throttleMs: GAME_THROTTLE }
    case 'milestone:new':
      return { title: '📸 Timeline', body: `${name} added a memory`, tag: 'timeline', throttleMs: GAME_THROTTLE }
    case 'visit:set':
      return { title: '✈️ Countdown', body: `${name} set your visit countdown`, tag: 'visit', throttleMs: GAME_THROTTLE }
    case 'bucket:new':
      return { title: '🪣 Bucket List', body: `${name} added a bucket-list idea`, tag: 'bucket', throttleMs: GAME_THROTTLE }
    default:
      return null
  }
}

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
  const partnerOnlineRef = useRef(false)
  partnerOnlineRef.current = partnerOnline
  const throttleRef = useRef<Map<string, number>>(new Map())
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
        // Keep this device's push subscription fresh (if already permitted).
        refreshPushSubscription(session)
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
        // Push the partner — but only if they're not currently in the app
        // (if they're online they already see it live).
        if (partnerOnlineRef.current) return
        const spec = buildNotif(event, payload, session.displayName)
        if (!spec) return
        const now = Date.now()
        const last = throttleRef.current.get(spec.tag) ?? 0
        if (spec.throttleMs && now - last < spec.throttleMs) return
        throttleRef.current.set(spec.tag, now)
        notifyPartner(session, {
          title: spec.title,
          body: spec.body,
          tag: spec.tag,
        })
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
