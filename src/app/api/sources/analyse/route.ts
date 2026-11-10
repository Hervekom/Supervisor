import { NextResponse } from 'next/server';
import { resolveChoice } from '@/lib/aiChoice';
import { fail, handle } from '@/lib/api';
import { limitSiteAi } from '@/lib/aiLimit';
import { checkUser } from '@/lib/auth';
import { analyseDeeply, MAX_PASSAGE_CHARS, MAX_SENT_CHARS, DEPTH, type SentPassage } from '@/lib/deepAnalysis';

// Phase P8: AI analysis of selected passages of one document. Only the passages the browser chose are received
// (never the file), within fixed limits. Nothing is stored or logged on the server.
export async function POST(req: Request) {
  try {
    const auth = await checkUser(req);
    if (!auth.ok) return fail(auth.error, auth.status);
    const b = (await req.json()) as { title?: string; passages?: unknown; language?: string; llm?: unknown };
    const raw = Array.isArray(b.passages) ? b.passages : [];
    if (!raw.length) return fail('This document has no passage to analyse.');
    if (raw.length > DEPTH.thorough.passages) return fail(`Send at most ${DEPTH.thorough.passages} passages at a time.`);
    const passages: SentPassage[] = raw.map((x) => {
      const p = (x ?? {}) as Partial<SentPassage>;
      return { id: String(p.id ?? '').slice(0, 20), where: String(p.where ?? '').slice(0, 60), section: String(p.section ?? '').slice(0, 120), text: String(p.text ?? '').slice(0, MAX_PASSAGE_CHARS) };
    });
    if (passages.some((p) => !/^p\d{1,6}$/.test(p.id) || p.text.trim().length < 20)) return fail('A passage could not be read. Reload the page and try again.');
    if (passages.reduce((n, p) => n + p.text.length, 0) > MAX_SENT_CHARS) return fail('These passages are too long to analyse at once. Choose a quicker analysis.');
    const { config, error } = resolveChoice(b.llm);
    if (error) return fail(error);
    limitSiteAi(auth.userId, !!config);
    return NextResponse.json(await analyseDeeply({ title: String(b.title ?? 'Untitled document'), passages, language: b.language }, config));
  } catch (e) {
    return handle(e);
  }
}
