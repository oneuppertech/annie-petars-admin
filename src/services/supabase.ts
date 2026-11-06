
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true
    }
  }
)
let currentSession: any = null

export const getCurrentSession = () => currentSession
let accessToken: string | null = null
let initializationPromise: Promise<void> | null = null

export const getAccessToken = () => accessToken

export function initializeSupabaseAuth() {
  if (initializationPromise) return initializationPromise

  initializationPromise = (async () => {
    const { data, error } = await supabase.auth.getSession()

    if (error) throw error

    currentSession = data.session
accessToken = data.session?.access_token ?? null

supabase.auth.onAuthStateChange((_event, session) => {
  currentSession = session
  accessToken = session?.access_token ?? null
})
  })().catch((error) => {
    initializationPromise = null
    throw error
  })

  return initializationPromise
}

