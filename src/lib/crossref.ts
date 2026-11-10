import { crossrefToDraft, DOI_PATTERN, normalizeDoi, type Draft } from './library';

// Phase P6: Crossref lookups for the reference library. Only a DOI, a title or an author name is sent.

export type LookupResult = { candidates: Draft[] } | { error: string; code: string; retryable: boolean; status: number };

const BUSY = 'Crossref did not answer. Your library was not changed. Try again in a minute, or enter the reference by hand.';

export async function lookupCrossref(q: { doi: string } | { query: string; field: 'title' | 'author' }, f: typeof fetch = fetch, mailto = process.env.CROSSREF_MAILTO): Promise<LookupResult> {
  const mail = mailto ? `mailto=${encodeURIComponent(mailto)}` : '';
  let url: string;
  if ('doi' in q) {
    const doi = normalizeDoi(q.doi);
    if (!doi || !DOI_PATTERN.test(doi)) return { error: 'This is not a valid DOI. A DOI starts with 10., followed by a slash, for example 10.1000/xyz123.', code: 'invalid_doi', retryable: false, status: 400 };
    url = `https://api.crossref.org/works/${encodeURIComponent(doi)}${mail ? `?${mail}` : ''}`;
  } else {
    url = `https://api.crossref.org/works?rows=5&${mail ? `${mail}&` : ''}${q.field === 'author' ? 'query.author' : 'query.bibliographic'}=${encodeURIComponent(q.query)}&select=DOI,type,title,container-title,author,issued,published-print,published-online,volume,issue,page,publisher,publisher-location,URL,institution`;
  }
  let res: Response;
  try {
    res = await f(url, { signal: AbortSignal.timeout(12_000), headers: { accept: 'application/json' } });
  } catch {
    return { error: BUSY, code: 'unreachable', retryable: true, status: 502 };
  }
  if ('doi' in q && res.status === 404) return { error: 'Crossref has no record for this DOI. Check it for typing mistakes. Some DOIs, including many Chinese journals, are registered with another agency: enter the reference by hand.', code: 'doi_not_found', retryable: false, status: 404 };
  if (!res.ok) return { error: BUSY, code: res.status === 429 ? 'rate_limited' : 'provider_down', retryable: true, status: 502 };
  try {
    const j = (await res.json()) as { message?: { items?: unknown[] } & Record<string, unknown> };
    const works = 'doi' in q ? [j.message] : (j.message?.items ?? []);
    return { candidates: works.filter(Boolean).map((w) => crossrefToDraft(w as Parameters<typeof crossrefToDraft>[0])).filter((d) => d.title) };
  } catch {
    return { error: BUSY, code: 'malformed', retryable: true, status: 502 };
  }
}
