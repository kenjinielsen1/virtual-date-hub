import { useEffect, useState } from 'react'
import type { Identity, Session } from '../lib/session'
import { labelForIdentity } from '../lib/session'
import { supabase } from '../lib/supabase'
import { RoomChannelProvider, useRoomChannel } from '../lib/RoomChannel'
import { Chat } from './Chat'
import { WatchParty } from './WatchParty'
import { Trivia } from './Trivia'
import { DailyNotes } from './DailyNotes'
import { Timeline } from './Timeline'
import { DrawCanvas } from './DrawCanvas'
import { Pictionary } from './Pictionary'
import { NeverHaveIEver } from './NeverHaveIEver'
import { CookAlong } from './CookAlong'
import { Playlist } from './Playlist'
import { VisitCountdown } from './VisitCountdown'
import { BucketList } from './BucketList'
import { NotifToggle } from './NotifToggle'
import { TimeZoneClocks } from './TimeZoneClocks'
import { Memories } from './Memories'
import {
  MessageCircle,
  Film,
  Brain,
  Eye,
  Palette,
  Pencil,
  ChefHat,
  Music,
  Plane,
  ListChecks,
  Mail,
  Camera,
  BookHeart,
  type LucideIcon,
} from 'lucide-react'

interface RoomShellProps {
  session: Session
  onLeave: () => void
}

type TabKey =
  | 'chat'
  | 'watch'
  | 'trivia'
  | 'nhie'
  | 'draw'
  | 'pictionary'
  | 'cook'
  | 'playlist'
  | 'countdown'
  | 'bucket'
  | 'daily'
  | 'timeline'
  | 'memories'

const TABS: { key: TabKey; label: string; icon: LucideIcon }[] = [
  { key: 'chat', label: 'Chat', icon: MessageCircle },
  { key: 'watch', label: 'Watch Party', icon: Film },
  { key: 'trivia', label: 'Trivia', icon: Brain },
  { key: 'nhie', label: 'Never Have I Ever', icon: Eye },
  { key: 'draw', label: 'Draw', icon: Palette },
  { key: 'pictionary', label: 'Pictionary', icon: Pencil },
  { key: 'cook', label: 'Cook Along', icon: ChefHat },
  { key: 'playlist', label: 'Playlist', icon: Music },
  { key: 'countdown', label: 'Countdown', icon: Plane },
  { key: 'bucket', label: 'Bucket List', icon: ListChecks },
  { key: 'daily', label: 'Daily & Notes', icon: Mail },
  { key: 'timeline', label: 'Timeline', icon: Camera },
  { key: 'memories', label: 'Memories', icon: BookHeart },
]

export function RoomShell({ session, onLeave }: RoomShellProps) {
  return (
    <RoomChannelProvider session={session}>
      <RoomShellInner session={session} onLeave={onLeave} />
    </RoomChannelProvider>
  )
}

function RoomShellInner({ session, onLeave }: RoomShellProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('chat')
  const { partnerOnline, on } = useRoomChannel()
  const partnerId: Identity = session.identity === 'me' ? 'her' : 'me'
  const partnerLabel = labelForIdentity(partnerId)

  // Unread love-notes badge on the Daily & Notes tab.
  const [unreadNotes, setUnreadNotes] = useState(0)

  useEffect(() => {
    supabase
      .from('notes')
      .select('id', { count: 'exact', head: true })
      .eq('room_id', session.roomCode)
      .eq('sender', partnerId)
      .eq('read', false)
      .then(({ count }) => setUnreadNotes(count ?? 0))
  }, [session.roomCode, partnerId])

  useEffect(() => {
    return on('note:new', (p) => {
      if ((p as { sender: Identity }).sender === partnerId)
        setUnreadNotes((c) => c + 1)
    })
  }, [on, partnerId])

  // Notes now stay sealed until opened; the badge decrements as each wax seal
  // is broken (LoveNotes fires this window event on open).
  useEffect(() => {
    const onRead = (e: Event) => {
      const n = (e as CustomEvent<{ count: number }>).detail?.count ?? 1
      setUnreadNotes((c) => Math.max(0, c - n))
    }
    window.addEventListener('vdh:note-read', onRead)
    return () => window.removeEventListener('vdh:note-read', onRead)
  }, [])

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top bar */}
      <header className="bg-paper/90 backdrop-blur border-b border-black/5 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-xl">💌</span>
            <div className="min-w-0">
              <div className="font-script text-2xl leading-normal text-ink whitespace-nowrap overflow-visible">
                {session.displayName}
              </div>
              <div className="text-xs text-stone-500 truncate tracking-wide">
                ✉ {session.roomCode}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-xs font-medium">
              <span
                className={`w-2 h-2 rounded-full ${
                  partnerOnline
                    ? 'bg-green-500 animate-pulse'
                    : 'bg-stone-300'
                }`}
              />
              <span
                className={partnerOnline ? 'text-green-600' : 'text-stone-400'}
              >
                {partnerOnline
                  ? `${partnerLabel} is online`
                  : `${partnerLabel} is away`}
              </span>
            </span>
            <NotifToggle session={session} />
            <button
              type="button"
              onClick={onLeave}
              className="text-xs text-stone-500 hover:text-stone-700 rounded-lg px-3 py-1.5 hover:bg-stone-100"
            >
              Leave
            </button>
          </div>
        </div>

        {/* Tab nav */}
        <nav className="max-w-4xl mx-auto px-2 flex gap-1 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`whitespace-nowrap px-4 py-2.5 text-sm font-medium border-b-2 transition inline-flex items-center gap-1.5 ${
                activeTab === tab.key
                  ? 'border-seal-500 text-seal-600'
                  : 'border-transparent text-stone-500 hover:text-stone-700'
              }`}
            >
              <tab.icon size={15} strokeWidth={1.75} />
              {tab.label}
              {tab.key === 'daily' && unreadNotes > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-seal-500 text-white text-[10px] min-w-4 h-4 px-1 align-middle">
                  {unreadNotes}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* Our two clocks — California & Denmark */}
        <TimeZoneClocks />
      </header>

      {/* Content */}
      <main className="flex-1 max-w-4xl w-full mx-auto p-4 min-h-0 flex flex-col">
        {activeTab === 'chat' && (
          <div className="flex-1 rounded-2xl bg-paper ring-1 ring-ink/10 shadow-sm p-4 flex flex-col min-h-0">
            <Chat session={session} showReset />
          </div>
        )}
        {activeTab === 'watch' && <WatchParty session={session} />}
        {activeTab === 'trivia' && <Trivia session={session} />}
        {activeTab === 'nhie' && <NeverHaveIEver session={session} />}
        {activeTab === 'draw' && <DrawCanvas session={session} />}
        {activeTab === 'pictionary' && <Pictionary session={session} />}
        {activeTab === 'cook' && <CookAlong session={session} />}
        {activeTab === 'playlist' && <Playlist session={session} />}
        {activeTab === 'countdown' && <VisitCountdown session={session} />}
        {activeTab === 'bucket' && <BucketList session={session} />}
        {activeTab === 'daily' && <DailyNotes session={session} />}
        {activeTab === 'timeline' && <Timeline session={session} />}
        {activeTab === 'memories' && <Memories session={session} />}
      </main>
    </div>
  )
}
