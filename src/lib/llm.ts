import { aiFailure, type AiCode } from './messages';
import { MESSAGES } from './messages';
import { PublicError } from './publicError';

export class LlmNotConfigured extends Error {
  constructor() {
    super(MESSAGES.aiNotConfigured);
  }
}

export type Message = { role: 'system' | 'user'; content: string };

export type LlmConfig = {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  /** For tests: how long one attempt may take, and how to wait between attempts. */
  attemptTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

/** One attempt may take this long. Two attempts stay well inside the platform's time limit. */
export const ATTEMPT_TIMEOUT_MS = 50_000;
/** At most one retry, only for failures that may pass on their own. */
export const MAX_ATTEMPTS = 2;
/** A provider asking to wait longer than this is not retried here: the student is told to wait. */
export const MAX_RETRY_WAIT_MS = 6_000;
/** After this long, a failure is shown instead of retried, so the reply never runs past the platform's time limit. */
export const RETRY_BUDGET_MS = 20_000;

/** An AI failure the student can understand. `code` and `retryable` let the page offer "Try again". */
export class AiError extends PublicError {
  constructor(readonly code: AiCode, readonly retryable: boolean, ownKey: boolean, status: number, readonly retryAfter?: number) {
    super(aiFailure(code, ownKey, retryAfter), status);
  }
}

function config(c?: LlmConfig) {
  // A key in the request is the student's own key. Without one, the site's key from the server is used.
  const ownKey = !!c?.apiKey;
  const baseUrl = c?.baseUrl ?? process.env.LLM_BASE_URL;
  const apiKey = c?.apiKey ?? process.env.LLM_API_KEY;
  const model = c?.model ?? process.env.LLM_MODEL;
  if (!baseUrl || !apiKey || !model) throw new LlmNotConfigured();
  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    apiKey,
    model,
    ownKey,
    fetchImpl: c?.fetchImpl ?? fetch,
    attemptTimeoutMs: c?.attemptTimeoutMs ?? ATTEMPT_TIMEOUT_MS,
    sleep: c?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))),
  };
}

export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1];
  const raw = fenced ?? text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The AI reply had no JSON object.');
  return JSON.parse(raw.slice(start, end + 1));
}

/** Seconds from a Retry-After header, when it gives a number of seconds or a date. */
export function retryAfterSeconds(h: string | null, now = Date.now()): number | undefined {
  if (!h) return undefined;
  const n = Number(h);
  if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
  const d = Date.parse(h);
  return Number.isNaN(d) ? undefined : Math.max(0, Math.ceil((d - now) / 1000));
}

/** Turns a provider answer into a classified failure. Never includes the key, the request or the reply text. */
export function classify(status: number, ownKey: boolean, retryAfter?: number): AiError {
  if (status === 401 || status === 403) return new AiError('invalid_key', false, ownKey, 502);
  if (status === 402) return new AiError('no_credit', false, ownKey, 502);
  if (status === 404) return new AiError('model_not_found', false, ownKey, 502);
  if (status === 429) return new AiError('provider_rate_limited', true, ownKey, 429, retryAfter);
  if (status === 408 || status === 504) return new AiError('timeout', true, ownKey, 504);
  if (status >= 500) return new AiError('provider_down', true, ownKey, 503);
  return new AiError('provider_rejected', false, ownKey, 502);
}

async function attempt(c: ReturnType<typeof config>, messages: Message[]): Promise<unknown> {
  let res: Response;
  try {
    res = await c.fetchImpl(`${c.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${c.apiKey}` },
      body: JSON.stringify({ model: c.model, messages, temperature: 0.2 }),
      redirect: 'error',
      signal: AbortSignal.timeout(c.attemptTimeoutMs),
    });
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === 'TimeoutError' || name === 'AbortError') throw new AiError('timeout', true, c.ownKey, 504);
    throw new AiError('unreachable', true, c.ownKey, 502);
  }
  if (!res.ok) throw classify(res.status, c.ownKey, retryAfterSeconds(res.headers.get('retry-after')));
  try {
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty reply.');
    return extractJson(content);
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === 'TimeoutError' || name === 'AbortError') throw new AiError('timeout', true, c.ownKey, 504);
    throw new AiError('malformed', true, c.ownKey, 502);
  }
}

/**
 * Asks the AI for a JSON reply. A failure that may pass on its own (no answer in time, provider busy or down,
 * connection cut, unreadable reply) is retried once, after a short wait. A rejected key, a missing model or
 * an empty account is never retried. Only one reply is ever returned, so nothing is saved twice.
 */
export async function chatJson(messages: Message[], c?: LlmConfig): Promise<unknown> {
  const cfg = config(c);
  const started = Date.now();
  let last: AiError | undefined;
  for (let n = 1; n <= MAX_ATTEMPTS; n++) {
    try {
      return await attempt(cfg, messages);
    } catch (e) {
      if (!(e instanceof AiError)) throw e;
      last = e;
      const waitMs = e.code === 'provider_rate_limited' ? (e.retryAfter ?? 2) * 1000 : 700 * n;
      // A slow provider is not asked twice: a second wait would run past the platform's time limit.
      if (!e.retryable || e.code === 'timeout' || n === MAX_ATTEMPTS || waitMs > MAX_RETRY_WAIT_MS || Date.now() - started + waitMs > RETRY_BUDGET_MS) break;
      await cfg.sleep(waitMs);
    }
  }
  throw last!;
}
