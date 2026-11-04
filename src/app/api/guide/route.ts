import { NextResponse } from 'next/server';
import { resolveChoice } from '@/lib/aiChoice';
import { fail, handle } from '@/lib/api';
import { checkUser } from '@/lib/auth';
import { tailorStep } from '@/lib/guide';
import { STEPS } from '@/lib/path';

export async function POST(req: Request) {
  try {
    const auth = await checkUser(req);
    if (!auth.ok) return fail(auth.error, auth.status);
    const b = (await req.json()) as { stepId?: string; degree?: string; title?: string; topic?: string; discipline?: string; history?: string; language?: string; llm?: unknown };
    const step = STEPS.find((s) => s.id === b.stepId);
    if (!step) return fail('This step no longer exists.');
    const { config, error } = resolveChoice(b.llm);
    if (error) return fail(error);
    return NextResponse.json(await tailorStep({ step, degree: b.degree ?? 'master_academic', title: b.title, topic: b.topic, discipline: b.discipline, history: b.history, language: b.language }, config));
  } catch (e) {
    return handle(e);
  }
}
