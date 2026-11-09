export type AuthCheck = { ok: true; userId?: string; email?: string; name?: string } | { ok: false; status: number; error: string };

export const AUTH_OFF_MESSAGE = 'Sign-in is not set up on this server, so AI features are switched off.';

/**
 * Whether requests may run without sign-in because Supabase is not configured.
 * Allowed in development and tests. In a production build it needs the explicit test flag
 * SUPERVISOR_OPEN_AUTH=1, and it is never allowed on Vercel production, whatever the flags say.
 */
export function openModeAllowed(env: Record<string, string | undefined> = process.env): boolean {
  if (env.VERCEL_ENV === 'production') return false;
  if (env.NODE_ENV !== 'production') return true;
  return env.SUPERVISOR_OPEN_AUTH === '1';
}

/** Verifies the caller's session with Supabase. Fails closed in production when sign-in is not configured. */
export async function checkUser(req: Request, f: typeof fetch = fetch, env: Record<string, string | undefined> = process.env): Promise<AuthCheck> {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return openModeAllowed(env) ? { ok: true } : { ok: false, status: 503, error: AUTH_OFF_MESSAGE };
  const header = req.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return { ok: false, status: 401, error: 'Sign in to use this feature.' };
  const res = await f(`${url}/auth/v1/user`, { headers: { apikey: key, authorization: header } });
  if (!res.ok) return { ok: false, status: 401, error: 'Your session has ended. Sign in again.' };
  const user = (await res.json().catch(() => null)) as { id?: string; email?: string; user_metadata?: { full_name?: unknown; name?: unknown } } | null;
  // Every signed-in request has a user ID, so the fair-use limit always applies to it.
  if (!user?.id) return { ok: false, status: 401, error: 'Your session has ended. Sign in again.' };
  // The display name, when the account has one, is used only to hide the student's own name before AI calls.
  const name = [user.user_metadata?.full_name, user.user_metadata?.name].find((v): v is string => typeof v === 'string' && !!v.trim());
  return { ok: true, userId: user.id, ...(typeof user.email === 'string' ? { email: user.email } : {}), ...(name ? { name: name.slice(0, 120) } : {}) };
}
