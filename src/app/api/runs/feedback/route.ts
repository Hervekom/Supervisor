import { NextResponse } from 'next/server';
import { resolveChoice } from '@/lib/aiChoice';
import { limitSiteAi } from '@/lib/aiLimit';
import { fail, handle } from '@/lib/api';
import { checkUser } from '@/lib/auth';
import { reviewRun } from '@/lib/runFeedback';
import { cleanRun, runProblems } from '@/lib/runs';

export async function POST(req: Request) {
  try {
    const auth = await checkUser(req);
    if (!auth.ok) return fail(auth.error, auth.status);
    const b = (await req.json()) as { run?: unknown; topic?: string; language?: string; llm?: unknown };
    // The record is cleaned and redacted again here, whatever the browser sent.
    const run = cleanRun(b.run);
    if (!run) return fail('Save the run first, then ask for feedback.');
    if (runProblems(run).length) return fail('Complete the run first, then ask for feedback.');
    const { config, error } = resolveChoice(b.llm);
    if (error) return fail(error);
    limitSiteAi(auth.userId, !!config);
    return NextResponse.json(await reviewRun(run, typeof b.topic === 'string' ? b.topic : undefined, typeof b.language === 'string' ? b.language : undefined, config));
  } catch (e) {
    return handle(e);
  }
}
