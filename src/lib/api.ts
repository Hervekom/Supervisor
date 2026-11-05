import { NextResponse } from 'next/server';
import { parseDocx } from './docx';
import { MAX_UPLOAD_BYTES } from './limits';
import { LlmNotConfigured } from './llm';
import { MESSAGES } from './messages';
import { PublicError } from './publicError';

export const MAX_UPLOAD = MAX_UPLOAD_BYTES;

export function fail(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

export function handle(e: unknown) {
  if (e instanceof LlmNotConfigured) return fail(e.message, 503);
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
