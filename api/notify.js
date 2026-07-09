// Vercel serverless function: send a Web Push to the partner's devices.
// Env vars (set in Vercel project settings, NOT VITE_-prefixed):
//   SUPABASE_URL, SUPABASE_ANON_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'

// Prefer the service_role key once it's set (required after auth lockdown, so
// this function can still read push_subscriptions under members-only RLS). Until
// then it falls back to the anon key, so behaviour is unchanged today.
const sb = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY,
)

webpush.setVapidDetails(
  'mailto:' + (process.env.VAPID_SUBJECT || 'hello@example.com'),
  process.env.VAPID_PUBLIC_KEY || process.env.VITE_VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY,
)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' })

  let data = req.body
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      data = {}
    }
  }
  const { roomCode, sender, title, body, tag } = data || {}
  if (!roomCode || !sender || !title) {
    return res.status(400).json({ error: 'missing fields' })
  }

  const partner = sender === 'me' ? 'her' : 'me'
  const { data: subs, error } = await sb
    .from('push_subscriptions')
    .select('endpoint, subscription')
    .eq('room_id', roomCode)
    .eq('identity', partner)
  if (error) return res.status(500).json({ error: error.message })

  const payload = JSON.stringify({ title, body: body || '', tag, url: '/' })
  let sent = 0
  await Promise.all(
    (subs || []).map(async (row) => {
      try {
        await webpush.sendNotification(row.subscription, payload)
        sent++
      } catch (e) {
        // Subscription expired/invalid → clean it up.
        if (e && (e.statusCode === 404 || e.statusCode === 410)) {
          await sb
            .from('push_subscriptions')
            .delete()
            .eq('endpoint', row.endpoint)
        }
      }
    }),
  )

  return res.status(200).json({ sent })
}
