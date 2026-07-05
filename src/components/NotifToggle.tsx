import { useState } from 'react'
import { Bell, BellOff, BellRing } from 'lucide-react'
import { enablePush, pushPermission, pushSupported } from '../lib/push'
import type { Session } from '../lib/session'

export function NotifToggle({ session }: { session: Session }) {
  const [perm, setPerm] = useState(pushPermission())
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState('')

  if (!pushSupported()) return null

  async function turnOn() {
    setBusy(true)
    setHint('')
    try {
      const r = await enablePush(session)
      setPerm(pushPermission())
      if (!r.ok && (r.reason === 'denied' || r.reason === 'default')) {
        setHint(
          'Blocked. On iPhone, add this to your Home Screen first, then allow notifications.',
        )
      }
    } catch {
      setHint('Couldn’t enable — on iPhone, install to Home Screen first.')
    } finally {
      setBusy(false)
    }
  }

  if (perm === 'granted') {
    return (
      <span
        title="Notifications are on"
        className="flex items-center gap-1 text-xs text-green-600"
      >
        <BellRing size={14} /> on
      </span>
    )
  }

  if (perm === 'denied') {
    return (
      <span
        title="Notifications are blocked in your browser/site settings"
        className="flex items-center gap-1 text-xs text-stone-400"
      >
        <BellOff size={14} /> off
      </span>
    )
  }

  return (
    <span className="relative">
      <button
        type="button"
        onClick={turnOn}
        disabled={busy}
        className="flex items-center gap-1 text-xs text-seal-600 rounded-lg px-2 py-1 hover:bg-seal-50 disabled:opacity-50"
      >
        <Bell size={14} /> {busy ? '…' : 'Notifications'}
      </button>
      {hint && (
        <span className="absolute right-0 top-8 z-20 w-56 rounded-lg bg-ink text-cream text-[11px] p-2 shadow-lg">
          {hint}
        </span>
      )}
    </span>
  )
}
