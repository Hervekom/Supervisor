import { NextResponse } from 'next/server';
import { resolveChoice } from '@/lib/aiChoice';
import { limitSiteAi } from '@/lib/aiLimit';
import { fail, handle } from '@/lib/api';
import { checkUser } from '@/lib/auth';
import { askChef, type ChefContext, type ChefMessage } from '@/lib/chef';

export async function POST(req: Request) {
  try {
    const auth = await checkUser(req);
    if (!auth.ok) return fail(auth.error, auth.status);
    const b = (await req.json()) as { context?: ChefContext; messages?: ChefMessage[]; language?: string; llm?: unknown };
    const messages = (Array.isArray(b.messages) ? b.messages : []).filter((m) => m && typeof m.content === 'string' && (m.role === 'student' || m.role === 'chef'));
    if (!messages.some((m) => m.role === 'student' && m.content.trim())) return fail('Write a message first.');
    const { config, error } = resolveChoice(b.llm);
    if (error) return fail(error);
    limitSiteAi(auth.userId, !!config);
    return NextResponse.json(await askChef(b.context ?? { started: false, structure: '', ingredients: [] }, messages, b.language, config));
  } catch (e) {
    return handle(e);
  }
}
