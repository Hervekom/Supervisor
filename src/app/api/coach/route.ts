import { NextResponse } from 'next/server';
import { checkUser } from '@/lib/auth';
import { resolveChoice } from '@/lib/aiChoice';
import { fail, handle } from '@/lib/api';
import { coach } from '@/lib/coach';
import { STEPS } from '@/lib/path';
import { DEGREE_LABELS, type DegreeType } from '@/lib/types';

export async function POST(req: Request) {
  try {
    const auth = await checkUser(req);
    if (!auth.ok) return fail(auth.error, auth.status);
    const b = (await req.json()) as { stepId?: string; degree?: string; topic?: string; discipline?: string; work?: string; question?: string; language?: string; llm?: unknown };
    const step = STEPS.find((s) => s.id === b.stepId);
    if (!step) return fail('This step no longer exists.');
    if (!b.degree || !(b.degree in DEGREE_LABELS)) return fail('Choose a degree.');
    if (!b.work || b.work.trim().length < 20) return fail('Write a few lines of your own work first, so your supervisor has something to respond to.');
    const { config, error } = resolveChoice(b.llm);
    if (error) return fail(error);
    return NextResponse.json(await coach({ step, degree: b.degree as DegreeType, topic: b.topic, discipline: b.discipline, work: b.work, question: b.question, language: b.language }, config));
  } catch (e) {
    return handle(e);
  }
}
