import { NextResponse } from 'next/server';
import { fail, handle } from '@/lib/api';
import { lookupCrossref } from '@/lib/crossref';

// Phase P6: finds publication metadata in Crossref by DOI, title or author. Only the search terms are sent to Crossref,
// never thesis text. The answer is Crossref's record, as it is: nothing missing is filled in.
export async function POST(req: Request) {
  try {
    const b = (await req.json()) as { doi?: unknown; query?: unknown; field?: unknown };
    const doi = typeof b.doi === 'string' ? b.doi : undefined;
    const query = typeof b.query === 'string' ? b.query.trim().slice(0, 300) : '';
    const field = b.field === 'author' ? 'author' : 'title';
    if (!doi && query.length < 3) return fail('Type a DOI, or at least 3 characters of a title or an author.');
    const r = await lookupCrossref(doi ? { doi } : { query, field });
    if ('error' in r) return NextResponse.json({ error: r.error, code: r.code, retryable: r.retryable }, { status: r.status });
    return NextResponse.json(r);
  } catch (e) {
    return handle(e);
  }
}
