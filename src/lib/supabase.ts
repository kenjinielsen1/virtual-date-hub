import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

// Fail loudly during development if env vars are missing, so we don't chase
// confusing "network" errors later.
export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

if (!supabaseConfigured) {
  console.warn(
    '[Virtual Date Hub] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
      'Copy .env.example to .env and fill in your Supabase values.',
  )
}

// We still create a client so imports don't crash; calls will just fail until
// env vars are provided.
// Auth options are safe to set now: with the auth UI flag off, nothing signs
// in, so these are inert; they just let sessions persist/refresh and let the
// magic-link/OTP callback be parsed once auth is switched on.
export const supabase = createClient(
  supabaseUrl ?? 'http://localhost',
  supabaseAnonKey ?? 'public-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
)
