import { NextResponse } from 'next/server';
import { limitSiteAi } from '@/lib/aiLimit';
import { checkUser } from '@/lib/auth';
import { resolveChoice } from '@/lib/aiChoice';
import { fail, handle } from '@/lib/api';
import { reviewChapter } from '@/lib/feedback';
import { DEGREE_LABELS, type DegreeType } from '@/lib/types';

export async function POST(req: Request) {
  try {
    const auth = await checkUser(req);
    if (!auth.ok) return fail(auth.error, auth.status);
    const b = (await req.json()) as { degree?: string; discipline?: string; title?: string; text?: string; language?: string; llm?: unknown };
    if (!b.text || b.text.trim().length < 200) return fail('Add at least 200 characters of chapter text.');
    if (!b.degree || !(b.degree in DEGREE_LABELS)) return fail('Choose a degree.');
    const { config, error } = resolveChoice(b.llm);
    if (error) return fail(error);
    limitSiteAi(auth.userId, !!config);
    return NextResponse.json(await reviewChapter({ degree: b.degree as DegreeType, discipline: b.discipline, title: b.title ?? 'Untitled chapter', text: b.text, language: b.language }, config));
  } catch (e) {
    return handle(e);
  }
}
