import { NextResponse } from 'next/server';
import { resolveChoice } from '@/lib/aiChoice';
import { fail, handle } from '@/lib/api';
import { checkUser } from '@/lib/auth';
import { chatJson } from '@/lib/llm';

export async function POST(req: Request) {
  try {
    const auth = await checkUser(req);
    if (!auth.ok) return fail(auth.error, auth.status);
    const { llm } = (await req.json()) as { llm?: unknown };
    const { config, error } = resolveChoice(llm);
    if (error) return fail(error);
    if (!config) return fail('Add your AI details first.');
    await chatJson([{ role: 'user', content: 'Reply with this JSON only: {"ok":true}' }], config);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handle(e);
  }
}
