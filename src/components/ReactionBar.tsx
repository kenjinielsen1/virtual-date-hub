import type { Reaction } from '../lib/reactions'
import type { Identity } from '../lib/session'

const PRESETS = ['❤️', '😂', '🥺', '🔥', '😘']

// Compact emoji row: presets are faint until used; counts appear once tapped;
// your own reactions get the seal-red ring. Tap toggles on/off.
export function ReactionBar({
  reactions,
  me,
  onToggle,
}: {
  reactions: Reaction[]
  me: Identity
  onToggle: (emoji: string) => void
}) {
  // Include any non-preset emoji that already exists on the item.
  const extra = [...new Set(reactions.map((r) => r.emoji))].filter(
    (e) => !PRESETS.includes(e),
  )
  return (
    <div className="flex items-center gap-1 mt-2 flex-wrap">
      {[...PRESETS, ...extra].map((emoji) => {
        const rs = reactions.filter((r) => r.emoji === emoji)
        const mine = rs.some((r) => r.reacted_by === me)
        return (
          <button
            key={emoji}
            type="button"
            onClick={() => onToggle(emoji)}
            className={`rounded-full px-1.5 py-0.5 text-sm leading-none transition border ${
              mine
                ? 'border-seal-400 bg-seal-50'
                : rs.length > 0
                  ? 'border-stone-200 bg-stone-50'
                  : 'border-transparent opacity-30 hover:opacity-100 grayscale hover:grayscale-0'
            }`}
            title={mine ? 'tap to remove' : 'react'}
          >
            {emoji}
            {rs.length > 0 && (
              <span className="ml-0.5 text-[10px] text-stone-500 tabular-nums">
                {rs.length}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
