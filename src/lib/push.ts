import { supabase } from './supabase'
import type { Session } from './session'

const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

export function pushPermission(): NotificationPermission | 'unsupported' {
  if (!pushSupported()) return 'unsupported'
  return Notification.permission
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

async function subscribeAndStore(session: Session): Promise<boolean> {
  if (!VAPID_PUBLIC) {
    console.warn('[push] VITE_VAPID_PUBLIC_KEY is not set')
    return false
  }
  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC) as BufferSource,
    })
  }
  const json = sub.toJSON()
  await supabase.from('push_subscriptions').upsert(
    {
      room_id: session.roomCode,
      identity: session.identity,
      endpoint: sub.endpoint,
      subscription: json,
    },
    { onConflict: 'endpoint' },
  )
  return true
}

// Called from a user gesture ("turn on notifications").
export async function enablePush(session: Session): Promise<
  { ok: true } | { ok: false; reason: string }
> {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' }
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return { ok: false, reason: perm }
  const ok = await subscribeAndStore(session)
  return ok ? { ok: true } : { ok: false, reason: 'no-vapid' }
}

// On load: if permission is already granted, refresh the stored subscription
// (endpoints can rotate) so we keep receiving pushes.
export async function refreshPushSubscription(session: Session) {
  if (!pushSupported() || Notification.permission !== 'granted') return
  try {
    await subscribeAndStore(session)
  } catch (e) {
    console.warn('[push] refresh failed', e)
  }
}

// Ask the backend to push the partner (only meaningful when they're offline).
export function notifyPartner(
  session: Session,
  payload: { title: string; body: string; tag?: string },
) {
  fetch('/api/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      roomCode: session.roomCode,
      sender: session.identity,
      ...payload,
    }),
    keepalive: true,
  }).catch(() => {})
}
