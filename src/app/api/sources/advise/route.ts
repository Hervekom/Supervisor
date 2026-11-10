import { NextResponse } from 'next/server';
import { resolveChoice } from '@/lib/aiChoice';
import { fail, handle } from '@/lib/api';
import { limitSiteAi } from '@/lib/aiLimit';
import { checkUser } from '@/lib/auth';
import { STEPS } from '@/lib/path';
import { adviseFromSources, MAX_EXCERPT_CHARS, MAX_EXCERPTS, type Excerpt } from '@/lib/sourceAdvice';

// Phase P7: advice on passages from the student's documents. Only the passages the student chose are received,
// at most five, each at most 1,200 characters. Nothing is stored or logged.
export async function POST(req: Request) {
  try {
    const auth = await checkUser(req);
    if (!auth.ok) return fail(auth.error, auth.status);
    const b = (await req.json()) as { stepId?: string; topic?: string; excerpts?: unknown; language?: string; llm?: unknown };
    const step = STEPS.find((s) => s.id === b.stepId);
    if (!step) return fail('This step no longer exists.');
    const raw = Array.isArray(b.excerpts) ? b.excerpts : [];
    if (!raw.length) return fail('Choose at least one passage first.');
    if (raw.length > MAX_EXCERPTS) return fail(`Send at most ${MAX_EXCERPTS} passages at a time.`);
    const excerpts: Excerpt[] = raw.map((x, i) => {
      const e = (x ?? {}) as Partial<Excerpt>;
      return { id: `e${i + 1}`, doc: String(e.doc ?? '').slice(0, 200), where: String(e.where ?? '').slice(0, 60), section: String(e.section ?? '').slice(0, 120), text: String(e.text ?? '').slice(0, MAX_EXCERPT_CHARS) };
    });
    if (excerpts.some((e) => e.text.trim().length < 20)) return fail('A passage is too short to discuss.');
    const { config, error } = resolveChoice(b.llm);
    if (error) return fail(error);
    limitSiteAi(auth.userId, !!config);
    return NextResponse.json(await adviseFromSources({ stepTitle: step.title, stepGoal: step.goal, topic: String(b.topic ?? ''), excerpts, language: b.language }, config));
  } catch (e) {
    return handle(e);
  }
}
