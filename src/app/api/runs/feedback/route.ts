import { NextResponse } from 'next/server';
import { resolveChoice } from '@/lib/aiChoice';
import { limitSiteAi } from '@/lib/aiLimit';
import { fail, handle } from '@/lib/api';
import { checkUser } from '@/lib/auth';
import { reviewRun } from '@/lib/runFeedback';
import { cleanRun, runProblems, withoutIdentity } from '@/lib/runs';

export async function POST(req: Request) {
  try {
    const auth = await checkUser(req);
    if (!auth.ok) return fail(auth.error, auth.status);
    const b = (await req.json()) as { run?: unknown; topic?: string; language?: string; llm?: unknown };
    // The record is cleaned and redacted again here, whatever the browser sent.
    const cleaned = cleanRun(b.run);
    if (!cleaned) return fail('Save the run first, then ask for feedback.');
    // The AI receives only the cleaned record, without the student's own name.
    const run = withoutIdentity(cleaned, auth.email);
    if (runProblems(run).length) return fail('Complete the run first, then ask for feedback.');
    const { config, error } = resolveChoice(b.llm);
    if (error) return fail(error);
    limitSiteAi(auth.userId, !!config);
    return NextResponse.json(await reviewRun(run, typeof b.topic === 'string' ? b.topic : undefined, typeof b.language === 'string' ? b.language : undefined, config));
  } catch (e) {
    return handle(e);
  }
}
