import { NextResponse } from 'next/server';
import { limitSiteAi } from '@/lib/aiLimit';
import { resolveChoice } from '@/lib/aiChoice';
import { fail, handle } from '@/lib/api';
import { checkUser } from '@/lib/auth';
import { buildPlan, MAX_QUESTIONS, nextQuestion, reviewParagraph, type DraftAnswer } from '@/lib/draftHelp';
import { STEPS } from '@/lib/path';
import { DEGREE_LABELS, type DegreeType } from '@/lib/types';

export async function POST(req: Request) {
  try {
    const auth = await checkUser(req);
    if (!auth.ok) return fail(auth.error, auth.status);
    const b = (await req.json()) as { stepId?: string; degree?: string; topic?: string; discipline?: string; language?: string; history?: string; answers?: DraftAnswer[]; paragraph?: string; llm?: unknown };
    const step = STEPS.find((s) => s.id === b.stepId);
    if (!step) return fail('This step no longer exists.');
    if (!b.degree || !(b.degree in DEGREE_LABELS)) return fail('Choose a degree.');
    const { config, error } = resolveChoice(b.llm);
    if (error) return fail(error);
    limitSiteAi(auth.userId, !!config);
    const input = { step, degree: b.degree as DegreeType, topic: b.topic, discipline: b.discipline, language: b.language, history: b.history };
    if (typeof b.paragraph === 'string') {
      if (b.paragraph.trim().length < 20) return fail('Write a few lines first, then ask for a check.');
      return NextResponse.json({ review: await reviewParagraph(input, b.paragraph, config) });
    }
    const answers = (Array.isArray(b.answers) ? b.answers : []).slice(0, MAX_QUESTIONS).filter((a) => a && typeof a.question === 'string' && typeof a.answer === 'string');
    if (answers.length >= MAX_QUESTIONS) return NextResponse.json({ plan: await buildPlan(input, answers, config) });
    return NextResponse.json({ question: await nextQuestion(input, answers, config) });
  } catch (e) {
    return handle(e);
  }
}
