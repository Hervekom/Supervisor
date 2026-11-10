import { MAX_UPLOAD_BYTES } from './limits';
import { MESSAGES } from './messages';

/** A failure with a message a student can act on. `retryable` means "Try again" may work. */
export class RequestError extends Error {
  constructor(message: string, readonly code = 'error', readonly retryable = false, readonly status = 0) {
    super(message);
  }
}

const SAFE = 'Your text is still here, nothing was lost.';
export const GATEWAY_TIMEOUT = `Supervisor took too long to answer. ${SAFE} Try again; a shorter text is answered faster.`;
export const GATEWAY_BUSY = `Supervisor could not finish this request. ${SAFE} Try again in a moment.`;

/** Sends a request and returns its JSON. Every failure becomes a message a student can act on. */
export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    // The student cancelled: nothing to retry.
    if (init?.signal?.aborted) throw new RequestError('Cancelled. Nothing was changed.', 'cancelled', false);
    throw new RequestError(MESSAGES.network, 'network', true);
  }
  if (res.status === 413) throw new RequestError(MESSAGES.fileTooLarge, 'too_large', false, 413);
  let body: { error?: string; code?: string; retryable?: boolean } | null = null;
  try {
    body = await res.json();
  } catch {
    // The platform answered instead of Supervisor, for example after a time limit.
    if (res.status === 504) throw new RequestError(GATEWAY_TIMEOUT, 'gateway_timeout', true, 504);
    if (res.status === 502 || res.status === 503) throw new RequestError(GATEWAY_BUSY, 'gateway_busy', true, res.status);
    throw new RequestError(MESSAGES.server, 'server', res.status >= 500, res.status);
  }
  if (!res.ok) throw new RequestError(body?.error || MESSAGES.server, body?.code || 'error', body?.retryable ?? res.status >= 500, res.status);
  return body as T;
}

/** A quick failure of these kinds most likely never reached the AI, so one silent retry is safe. */
const QUICK_RETRY = new Set(['network', 'gateway_busy']);
export const QUICK_MS = 8_000;

/**
 * For AI requests: the same request is sent again once, after a short wait, only when it failed fast and
 * before Supervisor could answer. Every other failure is shown, with "Try again" when it may pass.
 * Nothing is saved by a failed request, so a retry can never save a result twice.
 */
export async function requestAi<T>(url: string, init?: RequestInit, opts: { wait?: (ms: number) => Promise<void>; now?: () => number } = {}): Promise<T> {
  const now = opts.now ?? (() => Date.now());
  const wait = opts.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const started = now();
  try {
    return await request<T>(url, init);
  } catch (e) {
    if (!(e instanceof RequestError) || !QUICK_RETRY.has(e.code) || now() - started > QUICK_MS) throw e;
    await wait(1200);
    return request<T>(url, init);
  }
}

export const fileProblem = (file: File) => (file.size > MAX_UPLOAD_BYTES ? MESSAGES.fileTooLarge : '');

export const errorText = (x: unknown) => (x instanceof Error && x.message ? x.message : MESSAGES.server);
/** True when trying the same request again may work. */
export const canRetry = (x: unknown) => x instanceof RequestError && x.retryable;
