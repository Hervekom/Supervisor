import { NextResponse } from 'next/server';
import { parseDocx } from './docx';
import { MAX_UPLOAD_BYTES } from './limits';
import { AiError, LlmNotConfigured } from './llm';
import { MESSAGES } from './messages';
import { PublicError } from './publicError';

export const MAX_UPLOAD = MAX_UPLOAD_BYTES;

export function fail(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

export function handle(e: unknown) {
  if (e instanceof LlmNotConfigured) return NextResponse.json({ error: e.message, code: 'not_configured', retryable: false }, { status: 503 });
  // The page uses `code` and `retryable` to offer "Try again". The message is the only text shown.
  if (e instanceof AiError) {
    return NextResponse.json(
      { error: e.message, code: e.code, retryable: e.retryable, ...(e.retryAfter ? { retryAfter: e.retryAfter } : {}) },
      { status: e.status, headers: e.retryAfter ? { 'retry-after': String(e.retryAfter) } : undefined },
    );
  }
  if (e instanceof PublicError) return fail(e.message, e.status);
  return fail(MESSAGES.server, 500);
}

export async function uploaded(form: FormData, field = 'file') {
  const f = form.get(field);
  if (!(f instanceof File) || !f.size) return { error: 'Choose a file first.' } as const;
  if (f.size > MAX_UPLOAD) return { error: MESSAGES.fileTooLarge, status: 413 } as const;
  return { file: f, bytes: new Uint8Array(await f.arrayBuffer()) } as const;
}

/** Reads a Word file, and explains a damaged one in plain words. */
export async function openDocx(bytes: Uint8Array) {
  try {
    return await parseDocx(bytes);
  } catch {
    throw new PublicError(MESSAGES.documentUnreadable, 422);
  }
}
