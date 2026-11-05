import { MAX_UPLOAD_BYTES } from './limits';
import { MESSAGES } from './messages';

/** Sends a request and returns its JSON. Every failure becomes a message a student can act on. */
export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error(MESSAGES.network);
  }
  if (res.status === 413) throw new Error(MESSAGES.fileTooLarge);
  let body: { error?: string } | null = null;
  try {
    body = await res.json();
  } catch {
    throw new Error(MESSAGES.server);
  }
  if (!res.ok) throw new Error(body?.error || MESSAGES.server);
  return body as T;
}

export const fileProblem = (file: File) => (file.size > MAX_UPLOAD_BYTES ? MESSAGES.fileTooLarge : '');

export const errorText = (x: unknown) => (x instanceof Error && x.message ? x.message : MESSAGES.server);
