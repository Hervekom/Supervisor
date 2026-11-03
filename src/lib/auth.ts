export type AuthCheck = { ok: true } | { ok: false; status: number; error: string };

/** Verifies the caller's session with Supabase. Open when Supabase is not configured, as in tests. */
export async function checkUser(req: Request, f: typeof fetch = fetch): Promise<AuthCheck> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return { ok: true };
  const header = req.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return { ok: false, status: 401, error: 'Sign in to use this feature.' };
  const res = await f(`${url}/auth/v1/user`, { headers: { apikey: key, authorization: header } });
  return res.ok ? { ok: true } : { ok: false, status: 401, error: 'Your session has ended. Sign in again.' };
}
