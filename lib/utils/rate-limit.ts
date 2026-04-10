import { createAdminClient } from '@/lib/supabase/admin'

const MAX_ATTEMPTS = 5
const WINDOW_MINUTES = 15

/**
 * Check and record a login attempt for an IP address.
 * Returns { allowed: true } if under the limit, or { allowed: false, retryAfterSeconds }
 * Uses the `login_attempts` table in Supabase as the backing store
 * (works across Vercel serverless invocations, no Redis needed).
 */
export async function checkRateLimit(ip: string): Promise<
  { allowed: true } | { allowed: false; retryAfterSeconds: number }
> {
  const admin = createAdminClient()
  const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString()

  // Count recent attempts from this IP
  const { count } = await admin
    .from('login_attempts')
    .select('*', { count: 'exact', head: true })
    .eq('ip', ip)
    .gte('created_at', windowStart)

  if ((count ?? 0) >= MAX_ATTEMPTS) {
    // Find oldest attempt in window to calculate retry-after
    const { data: oldest } = await admin
      .from('login_attempts')
      .select('created_at')
      .eq('ip', ip)
      .gte('created_at', windowStart)
      .order('created_at', { ascending: true })
      .limit(1)
      .single()

    const oldestTime = oldest?.created_at ? new Date(oldest.created_at).getTime() : Date.now()
    const unlockAt = oldestTime + WINDOW_MINUTES * 60 * 1000
    const retryAfterSeconds = Math.ceil((unlockAt - Date.now()) / 1000)

    return { allowed: false, retryAfterSeconds: Math.max(retryAfterSeconds, 1) }
  }

  // Record this attempt
  await admin.from('login_attempts').insert({ ip })

  return { allowed: true }
}

/**
 * Clear login attempts for an IP after a successful login.
 */
export async function clearRateLimit(ip: string): Promise<void> {
  const admin = createAdminClient()
  await admin.from('login_attempts').delete().eq('ip', ip)
}
