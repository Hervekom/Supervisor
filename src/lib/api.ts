import { NextResponse } from 'next/server';
import { LlmNotConfigured } from './llm';

export const MAX_UPLOAD = 30 * 1024 * 1024;

export function fail(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

export function handle(e: unknown) {
  if (e instanceof LlmNotConfigured) return fail(e.message, 503);
  return fail(e instanceof Error ? e.message : 'The request failed.', 500);
}

export async function uploaded(form: FormData, field = 'file') {
  const f = form.get(field);
  if (!(f instanceof File) || !f.size) return { error: 'Choose a file first.' } as const;
  if (f.size > MAX_UPLOAD) return { error: 'This file is larger than 30 MB.' } as const;
  return { file: f, bytes: new Uint8Array(await f.arrayBuffer()) } as const;
}
