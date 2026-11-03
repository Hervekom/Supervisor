export type RefStatus = 'verified' | 'possible_match' | 'not_found' | 'unchecked';

export type RefResult = {
  entry: string;
  status: RefStatus;
  matchedTitle?: string;
  doi?: string;
  score?: number;
  note?: string;
};

const words = (s: string) => new Set(s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 2));

export function similarity(a: string, b: string) {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / Math.min(A.size, B.size) * (Math.min(A.size, B.size) / Math.max(A.size, B.size)) ** 0.25;
}

export function titleOf(entry: string) {
  const t = entry.replace(/^\[\d+\]\s*/, '');
  const gb = t.match(/^[^.]*\.\s*(.+?)\s*\[[A-Z]{1,2}(?:\/[A-Z]{2})?\]/);
  if (gb) return gb[1];
  const apa = t.match(/\(\d{4}[a-z]?\)\.\s*(.+?)\./);
  return apa ? apa[1] : t;
}

export const doiOf = (entry: string) => entry.match(/\b10\.\d{4,9}\/[^\s,;]+/)?.[0]?.replace(/[.)]+$/, '');

async function one(entry: string, f: typeof fetch, mailto?: string): Promise<RefResult> {
  const mail = mailto ? `mailto=${encodeURIComponent(mailto)}&` : '';
  const doi = doiOf(entry);
  const title = titleOf(entry);
  try {
    if (doi) {
      const res = await f(`https://api.crossref.org/works/${encodeURIComponent(doi)}${mail ? `?${mail.slice(0, -1)}` : ''}`, { signal: AbortSignal.timeout(15000) });
      if (res.status === 200) {
        const j = (await res.json()) as { message: { title?: string[]; DOI: string } };
        const matched = j.message.title?.[0] ?? '';
        const score = similarity(title, matched);
        if (score >= 0.6) return { entry, status: 'verified', matchedTitle: matched, doi: j.message.DOI, score };
        return { entry, status: 'possible_match', matchedTitle: matched, doi: j.message.DOI, score, note: 'This DOI exists but points to a different title.' };
      }
      if (res.status !== 404) return { entry, status: 'unchecked', note: `Crossref returned ${res.status}.` };
    }
    const res = await f(`https://api.crossref.org/works?${mail}rows=3&select=title,DOI&query.bibliographic=${encodeURIComponent(title.slice(0, 300))}`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { entry, status: 'unchecked', note: `Crossref returned ${res.status}.` };
    const j = (await res.json()) as { message: { items: { title?: string[]; DOI: string }[] } };
    let best: RefResult | null = null;
    for (const it of j.message.items) {
      const matched = it.title?.[0] ?? '';
      const score = similarity(title, matched);
      if (!best || score > (best.score ?? 0)) best = { entry, status: 'not_found', matchedTitle: matched, doi: it.DOI, score };
    }
    if (best && (best.score ?? 0) >= 0.85) return { ...best, status: 'verified' };
    if (best && (best.score ?? 0) >= 0.5) return { ...best, status: 'possible_match', note: 'Compare this title with your entry.' };
    return { entry, status: 'not_found', note: 'No close match in Crossref. Books, standards, reports and some regional journals are often missing, so check the original.' };
  } catch {
    return { entry, status: 'unchecked', note: 'Crossref could not be reached.' };
  }
}

export async function verifyReferences(entries: string[], f: typeof fetch = fetch, mailto = process.env.CROSSREF_MAILTO): Promise<RefResult[]> {
  const list = entries.slice(0, 300);
  const out: RefResult[] = new Array(list.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < list.length) {
        const i = next++;
        out[i] = await one(list[i], f, mailto);
      }
    }),
  );
  return out;
}
