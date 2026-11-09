import { describe, expect, it } from 'vitest';
import { AUTH_OFF_MESSAGE, checkUser, openModeAllowed } from '@/lib/auth';
import { AI_PER_MINUTE, limitSiteAi } from '@/lib/aiLimit';

const SUPA = { NEXT_PUBLIC_SUPABASE_URL: 'http://supabase.test', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' };
const user = (async () => new Response(JSON.stringify({ id: 'student-1', email: 'student@example.test' }))) as typeof fetch;
const bearer = new Request('http://x', { headers: { authorization: 'Bearer t' } });

describe('sign-in configuration and AI requests', () => {
  it('production with Supabase configured: signed-in requests pass, signed-out requests are refused', async () => {
    const env = { NODE_ENV: 'production', VERCEL_ENV: 'production', ...SUPA };
    expect(await checkUser(bearer, user, env)).toEqual({ ok: true, userId: 'student-1', email: 'student@example.test' });
    expect(await checkUser(new Request('http://x'), user, env)).toMatchObject({ ok: false, status: 401 });
  });
  it('production without Supabase configuration fails closed, with a message that names no setting', async () => {
    for (const env of [{ NODE_ENV: 'production' }, { NODE_ENV: 'production', VERCEL_ENV: 'preview' }, { NODE_ENV: 'production', VERCEL_ENV: 'production', SUPERVISOR_OPEN_AUTH: '1' }]) {
      const r = await checkUser(bearer, user, env);
      expect(r, JSON.stringify(env)).toEqual({ ok: false, status: 503, error: AUTH_OFF_MESSAGE });
      expect(AUTH_OFF_MESSAGE).not.toMatch(/SUPABASE|LLM|KEY|env/i);
    }
  });
  it('the test flag never opens Vercel production', () => {
    expect(openModeAllowed({ NODE_ENV: 'production', VERCEL_ENV: 'production', SUPERVISOR_OPEN_AUTH: '1' })).toBe(false);
    expect(openModeAllowed({ NODE_ENV: 'production', SUPERVISOR_OPEN_AUTH: '1' })).toBe(true);
    expect(openModeAllowed({ NODE_ENV: 'production', SUPERVISOR_OPEN_AUTH: 'true' })).toBe(false);
  });
  it('development and tests may run without sign-in', async () => {
    expect(await checkUser(new Request('http://x'), user, { NODE_ENV: 'development' })).toEqual({ ok: true });
    expect(await checkUser(new Request('http://x'), user, { NODE_ENV: 'test' })).toEqual({ ok: true });
  });
  it('signed-in users are always counted by the fair-use limit', () => {
    const now = Date.UTC(2026, 10, 9, 10, 0, 0);
    for (let i = 0; i < AI_PER_MINUTE; i++) limitSiteAi('student-rate', false, now);
    expect(() => limitSiteAi('student-rate', false, now)).toThrow();
    // A student's own AI key is not limited by the site.
    expect(() => limitSiteAi('student-rate', true, now)).not.toThrow();
  });
});
