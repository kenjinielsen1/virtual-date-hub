import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useRoomChannel } from '../lib/RoomChannel'
import { labelForIdentity, type Identity, type Session } from '../lib/session'
import { ResetButton } from './ResetButton'

export interface ChatMessage {
  id: string
  room_id: string
  sender: string
  sender_name: string | null
  body: string
  created_at: string
}

// Broadcast payload for a freshly-sent message (instant delivery to partner,
// separate from the DB insert which is for persistence/history).
interface ChatBroadcast {
  id: string
  sender: string
  sender_name: string | null
  body: string
  created_at: string
}

export function Chat({
  session,
  showReset = false,
}: {
  session: Session
  showReset?: boolean
}) {
  const { broadcast, on } = useRoomChannel()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const bottomRef = useRef<HTMLDivElement | null>(null)

  // Load history once on mount.
  useEffect(() => {
    let cancelled = false
    supabase
      .from('messages')
      .select('*')
      .eq('room_id', session.roomCode)
      .order('created_at', { ascending: true })
      .limit(200)
      .then(({ data }) => {
        if (!cancelled && data) setMessages(data as ChatMessage[])
      })
    return () => {
      cancelled = true
    }
  }, [session.roomCode])

  // Live reset (partner cleared the chat).
  useEffect(() => {
    return on('chat:reset', () => setMessages([]))
  }, [on])

  async function resetChat() {
    setMessages([])
    broadcast('chat:reset', {})
    await supabase.from('messages').delete().eq('room_id', session.roomCode)
  }

  // Receive partner messages live via broadcast.
  useEffect(() => {
    return on('chat', (payload) => {
      const msg = payload as ChatBroadcast
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev
        return [...prev, { ...msg, room_id: session.roomCode }]
      })
    })
  }, [on, session.roomCode])

  // Auto-scroll to newest.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  async function send() {
    const body = draft.trim()
    if (!body) return
    setDraft('')

    const optimistic: ChatMessage = {
      id: crypto.randomUUID(),
      room_id: session.roomCode,
      sender: session.identity,
      sender_name: session.displayName,
      body,
      created_at: new Date().toISOString(),
    }
    // Show immediately for the sender.
    setMessages((prev) => [...prev, optimistic])

    // Broadcast for the partner's instant delivery.
    broadcast('chat', {
      id: optimistic.id,
      sender: optimistic.sender,
      sender_name: optimistic.sender_name,
      body: optimistic.body,
      created_at: optimistic.created_at,
    } satisfies ChatBroadcast)

    // Persist for history.
    await supabase.from('messages').insert({
      id: optimistic.id,
      room_id: session.roomCode,
      sender: session.identity,
      sender_name: session.displayName,
      body,
    })
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {showReset && (
        <div className="flex justify-end mb-1">
          <ResetButton
            label="Clear chat"
            confirm="Delete all chat messages for both of you?"
            onReset={resetChat}
          />
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
        {messages.length === 0 && (
          <p className="text-center text-stone-400 text-sm mt-8">
            No messages yet — say hi 👋
          </p>
        )}
        {messages.map((m) => {
          const mine = m.sender === session.identity
          return (
            <div
              key={m.id}
              className={`flex ${mine ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                  mine
                    ? 'bg-[#cd6f7e] text-white rounded-br-sm'
                    : 'bg-[#f6e2e5] text-ink rounded-bl-sm'
                }`}
              >
                {!mine && (
                  <div className="text-[11px] font-medium opacity-70 mb-0.5">
                    {m.sender_name || labelForIdentity(m.sender as Identity)}
                  </div>
                )}
                <div className="whitespace-pre-wrap break-words">{m.body}</div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      <div className="mt-3 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message…"
          className="flex-1 rounded-xl border border-stone-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-seal-300"
        />
        <button
          type="button"
          onClick={send}
          className="rounded-xl bg-seal-500 text-white px-4 py-2 text-sm font-medium hover:bg-seal-600 transition"
        >
          Send
        </button>
      </div>
    </div>
  )
}
