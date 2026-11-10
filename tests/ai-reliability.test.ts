import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AI_PER_MINUTE, limitSiteAi } from '@/lib/aiLimit';
import { handle } from '@/lib/api';
import { addReport, buildReport } from '@/lib/chapterFeedback';
import { AiError, chatJson, classify, retryAfterSeconds, type LlmConfig } from '@/lib/llm';
import { emptyPath } from '@/lib/path';
import { canRetry, GATEWAY_TIMEOUT, request, requestAi, RequestError } from '@/lib/request';

// Phase P4: AI failures are classified, retried once when safe, and explained without secrets.
const KEY = 'sk-own-key-123456789';
const ok = (obj: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(obj) } }] }), { status: 200 });
const status = (s: number, headers: Record<string, string> = {}) => new Response('{"error":{"message":"provider detail with secret sk-abc"}}', { status: s, headers });
type Step = Response | Error | 'hang';
function provider(steps: Step[]) {
  const calls: RequestInit[] = [];
  const fetchImpl = (async (_u: string, init: RequestInit) => {
    calls.push(init);
    const s = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (s === 'hang') {
      return new Promise<Response>((_r, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason)));
    }
    if (s instanceof Error) throw s;
    return s.clone();
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}
const waits: number[] = [];
const cfg = (fetchImpl: typeof fetch, own = true): LlmConfig => ({ baseUrl: 'https://ai.example.test/v1', model: 'm', ...(own ? { apiKey: KEY } : {}), fetchImpl, attemptTimeoutMs: 40, sleep: async (ms) => { waits.push(ms); } });
const failure = (p: Promise<unknown>) => p.then(() => { throw new Error('expected a failure'); }, (e) => e as AiError);

beforeEach(() => {
  waits.length = 0;
  process.env.LLM_API_KEY = 'site-key-should-never-leak';
});
afterEach(() => {
  delete process.env.LLM_API_KEY;
});

describe('provider failures', () => {
  it('timeout: one attempt only, a clear message, offered again', async () => {
    const p = provider(['hang']);
    const e = await failure(chatJson([], cfg(p.fetchImpl)));
    expect([e.code, e.retryable, e.status, p.calls.length]).toEqual(['timeout', true, 504, 1]);
    expect(e.message).toMatch(/took too long/);
  });
  it('429: retried once after the wait the provider asks for, then succeeds', async () => {
    const p = provider([status(429, { 'retry-after': '2' }), ok({ fine: true })]);
    expect(await chatJson([], cfg(p.fetchImpl))).toEqual({ fine: true });
    expect([p.calls.length, waits]).toEqual([2, [2000]]);
  });
  it('429 with a long wait: not retried, the student is told how long to wait', async () => {
    const p = provider([status(429, { 'retry-after': '120' })]);
    const e = await failure(chatJson([], cfg(p.fetchImpl, false)));
    expect([e.code, e.retryable, e.status, p.calls.length]).toEqual(['provider_rate_limited', true, 429, 1]);
    expect(e.message).toMatch(/free AI is busy/);
    expect(e.message).toMatch(/about 2 minutes/);
  });
  it('429 twice: two attempts at most', async () => {
    const p = provider([status(429), status(429), ok({})]);
    const e = await failure(chatJson([], cfg(p.fetchImpl)));
    expect([e.code, p.calls.length]).toEqual(['provider_rate_limited', 2]);
  });
  it('401: never retried; the message depends on whose key it is', async () => {
    const own = provider([status(401)]);
    const e1 = await failure(chatJson([], cfg(own.fetchImpl)));
    expect([e1.code, e1.retryable, own.calls.length]).toEqual(['invalid_key', false, 1]);
    expect(e1.message).toMatch(/rejected this key/);
    const site = provider([status(401)]);
    const e2 = await failure(chatJson([], cfg(site.fetchImpl, false)));
    expect(e2.message).toMatch(/problem on our side/);
    expect(e2.message).not.toMatch(/rejected this key/);
  });
  it('500: retried once, then explained as an outage', async () => {
    const p = provider([status(500), status(503)]);
    const e = await failure(chatJson([], cfg(p.fetchImpl)));
    expect([e.code, e.retryable, e.status, p.calls.length]).toEqual(['provider_down', true, 503, 2]);
    const q = provider([status(502), ok({ back: 1 })]);
    expect(await chatJson([], cfg(q.fetchImpl))).toEqual({ back: 1 });
  });
  it('network failure: retried once', async () => {
    const p = provider([new TypeError('fetch failed: ECONNRESET 10.0.0.1'), new TypeError('fetch failed')]);
    const e = await failure(chatJson([], cfg(p.fetchImpl)));
    expect([e.code, p.calls.length]).toEqual(['unreachable', 2]);
    expect(e.message).not.toMatch(/10\.0\.0\.1|ECONNRESET/);
  });
  it('malformed output: retried once, then a plain message', async () => {
    const bad = new Response(JSON.stringify({ choices: [{ message: { content: 'Sure! Here is text, no JSON.' } }] }));
    const p = provider([bad, ok({ summary: 'fixed' })]);
    expect(await chatJson([], cfg(p.fetchImpl))).toEqual({ summary: 'fixed' });
    const q = provider([new Response('not json at all'), new Response('{}')]);
    const e = await failure(chatJson([], cfg(q.fetchImpl)));
    expect([e.code, q.calls.length]).toEqual(['malformed', 2]);
  });
  it('402, 404 and other refusals are never retried', async () => {
    for (const [s, code] of [[402, 'no_credit'], [404, 'model_not_found'], [400, 'provider_rejected']] as const) {
      const p = provider([status(s)]);
      expect([(await failure(chatJson([], cfg(p.fetchImpl)))).code, p.calls.length]).toEqual([code, 1]);
    }
  });
  it('no message ever contains a key, provider text or the request', async () => {
    for (const s of [400, 401, 402, 404, 429, 500, 504]) {
      const own = classify(s, true).message;
      const site = classify(s, false).message;
      for (const m of [own, site]) {
        expect(m).not.toMatch(/sk-|site-key|secret|provider detail/);
        expect(m).toMatch(/nothing was lost|Your work is safe/);
      }
    }
  });
  it('reads Retry-After as seconds or a date', () => {
    expect(retryAfterSeconds('7')).toBe(7);
    expect(retryAfterSeconds(new Date(Date.now() + 30_000).toUTCString())).toBeGreaterThanOrEqual(29);
    expect(retryAfterSeconds('soon')).toBeUndefined();
  });
});

describe('the API answer', () => {
  it('gives the message, a code and whether trying again may work', async () => {
    const r = handle(classify(503, false));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: classify(503, false).message, code: 'provider_down', retryable: true });
    const t = handle(new AiError('provider_rate_limited', true, false, 429, 30));
    expect(t.headers.get('retry-after')).toBe('30');
  });
  it('site limits: the minute limit says when to try again, the daily one is not retryable', () => {
    const now = Date.UTC(2026, 10, 10, 6, 0, 15);
    for (let i = 0; i < AI_PER_MINUTE; i++) limitSiteAi('p4-user', false, now);
    let e: AiError | undefined;
    try {
      limitSiteAi('p4-user', false, now);
    } catch (x) {
      e = x as AiError;
    }
    expect([e?.code, e?.retryable, e?.status, e?.retryAfter]).toEqual(['site_minute_limit', true, 429, 45]);
    expect(e?.message).toMatch(/wait about 45 seconds/);
    expect(classify(429, true).message).toMatch(/Your AI provider/);
    // Own keys are not counted.
    expect(() => limitSiteAi('p4-user', true, now)).not.toThrow();
  });
});

describe('in the browser', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  const sequence = (steps: (Response | Error)[]) => {
    let n = 0;
    const fn = vi.fn(async () => {
      const s = steps[Math.min(n++, steps.length - 1)];
      if (s instanceof Error) throw s;
      return s.clone();
    });
    globalThis.fetch = fn as unknown as typeof fetch;
    return fn;
  };
  it('a fast network failure is sent again once, silently', async () => {
    const f = sequence([new TypeError('Failed to fetch'), new Response('{"ok":1}')]);
    expect(await requestAi('/api/x', {}, { wait: async () => {} })).toEqual({ ok: 1 });
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('a second failure is shown, with Try again', async () => {
    const f = sequence([new TypeError('Failed to fetch')]);
    const e = await requestAi('/api/x', {}, { wait: async () => {} }).catch((x) => x);
    expect(f).toHaveBeenCalledTimes(2);
    expect(canRetry(e)).toBe(true);
  });
  it('a slow failure is not sent again, so the AI is not asked twice', async () => {
    const f = sequence([new TypeError('Failed to fetch')]);
    let t = 0;
    await requestAi('/api/x', {}, { wait: async () => {}, now: () => (t += 10_000) }).catch(() => {});
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('the platform time limit is explained and never retried automatically', async () => {
    const f = sequence([new Response('<html>Gateway Timeout</html>', { status: 504 })]);
    const e = (await requestAi('/api/x', {}, { wait: async () => {} }).catch((x) => x)) as RequestError;
    expect([e.message, e.code, e.retryable, f.mock.calls.length]).toEqual([GATEWAY_TIMEOUT, 'gateway_timeout', true, 1]);
  });
  it('an AI error from Supervisor keeps its message and code, and is not resent', async () => {
    const f = sequence([new Response(JSON.stringify({ error: 'The AI service is having problems right now.', code: 'provider_down', retryable: true }), { status: 503 })]);
    const e = (await requestAi('/api/x', {}, { wait: async () => {} }).catch((x) => x)) as RequestError;
    expect([e.code, e.retryable, f.mock.calls.length]).toEqual(['provider_down', true, 1]);
    const g = sequence([new Response(JSON.stringify({ error: 'Your AI provider rejected this key.', code: 'invalid_key', retryable: false }), { status: 502 })]);
    expect(canRetry(await request('/api/x').catch((x) => x))).toBe(false);
    expect(g).toHaveBeenCalledTimes(1);
  });
});

describe('no duplicate saved feedback', () => {
  it('"Try again" reuses the request ID, so a second answer to the same request is not saved again', () => {
    const p = { ...emptyPath(), started: true };
    const fb = (summary: string) => ({ summary, strengths: [], issues: [], next_steps: [] });
    const settings = { degree: 'master_academic', discipline: '', language: 'English' };
    const first = addReport(p, buildReport({ chapter: 'C1', text: 'Text', feedback: fb('A'), settings, requestId: 'req-1' }, '2026-11-10T06:00:00.000Z', 'r1'));
    expect(first.status).toBe('added');
    const again = addReport(first.path, buildReport({ chapter: 'C1', text: 'Text', feedback: fb('B'), settings, requestId: 'req-1' }, '2026-11-10T06:00:10.000Z', 'r2'));
    expect(again.status).toBe('duplicate');
    const fresh = addReport(first.path, buildReport({ chapter: 'C1', text: 'Text', feedback: fb('B'), settings, requestId: 'req-2' }, '2026-11-10T06:01:00.000Z', 'r3'));
    expect(fresh.status).toBe('added');
  });
});
