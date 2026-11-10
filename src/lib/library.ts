// Phase P6: the student's reference library, stored inside PathState (`library`), so it is saved and synced with the
// thesis like everything else: no new table. Every field comes from the student, a BibTeX file they imported, or a
// Crossref record they chose. A missing field stays missing: it is reported, never filled in.

import type { PathState } from './path';

export type RefType = 'article' | 'book' | 'chapter' | 'conference' | 'thesis' | 'report' | 'web' | 'other';
export type Person = { family: string; given?: string } | { literal: string };
export type RefSource = 'crossref' | 'manual' | 'bibtex';
export type CitationStyle = 'apa7' | 'gbt7714';

export type LibRef = {
  id: string;
  /** What the student types to cite it: [@key]. */
  key: string;
  type: RefType;
  title: string;
  authors: Person[];
  year?: string;
  /** Journal, book, proceedings or website name. */
  container?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  publisher?: string;
  place?: string;
  /** University, for a thesis. */
  school?: string;
  thesisKind?: 'phd' | 'masters';
  doi?: string;
  url?: string;
  source: RefSource;
  /** When the metadata was copied from Crossref. */
  verifiedAt?: string;
  /** The student changed a Crossref record after it was copied. */
  edited?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Library = { style?: CitationStyle; refs: LibRef[] };

export const STYLE_LABELS: Record<CitationStyle, string> = {
  apa7: 'APA 7 (author–date)',
  gbt7714: 'GB/T 7714 numeric (2015 rules)',
};
export const TYPE_LABELS: Record<RefType, string> = {
  article: 'Journal article', book: 'Book', chapter: 'Book chapter', conference: 'Conference paper',
  thesis: 'Thesis', report: 'Report', web: 'Web page', other: 'Other',
};

const str = (v: unknown, n = 2000) => (typeof v === 'string' ? v.trim().slice(0, n) : undefined) || undefined;
const isPerson = (p: unknown): p is Person => !!p && typeof p === 'object' && (typeof (p as { family?: unknown }).family === 'string' || typeof (p as { literal?: unknown }).literal === 'string');

/** Readable references from a saved copy. Older copies have none. Unknown fields are ignored, nothing is guessed. */
export function libraryOf(p: PathState | null | undefined): Library {
  const raw = (p as { library?: unknown } | null | undefined)?.library as Partial<Library> | undefined;
  const refs = Array.isArray(raw?.refs) ? raw!.refs.filter((r): r is LibRef => !!r && typeof r.id === 'string' && typeof r.key === 'string' && typeof r.title === 'string' && Array.isArray(r.authors)) : [];
  return { style: raw?.style === 'gbt7714' || raw?.style === 'apa7' ? raw.style : undefined, refs: refs.map((r) => ({ ...r, authors: r.authors.filter(isPerson) })) };
}

export const hasHan = (s: string) => /\p{Script=Han}/u.test(s);
export const normalizeDoi = (d?: string) => d?.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').replace(/[.,;)]+$/, '').toLowerCase() || undefined;
export const DOI_PATTERN = /^10\.\d{4,9}\/\S+$/;
const plain = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export const familyOf = (p: Person) => ('literal' in p ? p.literal : p.family);

// ---------- Completeness and status ----------

const REQUIRED: Record<RefType, (keyof LibRef)[]> = {
  article: ['container', 'year'],
  book: ['publisher', 'year'],
  chapter: ['container', 'publisher', 'year'],
  conference: ['container', 'year'],
  thesis: ['school', 'year'],
  report: ['year'],
  web: ['url'],
  other: ['year'],
};
const FIELD_LABELS: Partial<Record<keyof LibRef, string>> = { container: 'journal or book', year: 'year', publisher: 'publisher', school: 'university', url: 'web address', title: 'title' };

/** Fields a reference of this type needs and does not have. */
export function missingFields(r: LibRef): string[] {
  const out: string[] = [];
  if (!r.title.trim()) out.push('title');
  if (!r.authors.length) out.push('authors');
  for (const f of REQUIRED[r.type]) if (!r[f]) out.push(FIELD_LABELS[f] ?? String(f));
  return out;
}

export type RefState = 'verified' | 'verified_edited' | 'manual' | 'bibtex';
export const stateOf = (r: LibRef): RefState => (r.source === 'crossref' ? (r.edited ? 'verified_edited' : 'verified') : r.source);
export const STATE_LABELS: Record<RefState, string> = {
  verified: 'Verified with Crossref',
  verified_edited: 'From Crossref, edited by you',
  manual: 'Entered by you',
  bibtex: 'Imported from BibTeX',
};

// ---------- Keys and duplicates ----------

/** A citation key like "smith2024" or "王小明2025", unique in the library. */
export function makeKey(r: Pick<LibRef, 'authors' | 'year' | 'title'>, taken: Set<string>, wanted?: string) {
  const clean = (s: string) => s.replace(/[^\p{L}\p{N}_:-]/gu, '');
  let base = wanted ? clean(wanted) : '';
  if (!base) {
    const first = r.authors[0] ? familyOf(r.authors[0]) : r.title.split(/\s+/)[0] ?? 'ref';
    base = clean(hasHan(first) ? first : first.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')) + (r.year ?? '');
  }
  base ||= 'ref';
  if (!taken.has(base)) return base;
  for (const s of 'abcdefghijklmnopqrstuvwxyz') if (!taken.has(base + s)) return base + s;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** The existing reference this one duplicates: the same DOI, or the same title, year and first author. */
export function duplicateOf(r: Pick<LibRef, 'doi' | 'title' | 'year' | 'authors'>, refs: LibRef[], exceptId?: string): LibRef | undefined {
  const doi = normalizeDoi(r.doi);
  const title = plain(r.title);
  const first = r.authors[0] ? plain(familyOf(r.authors[0])) : '';
  return refs.find((x) => x.id !== exceptId && ((doi && normalizeDoi(x.doi) === doi) || (!!title && plain(x.title) === title && (x.year ?? '') === (r.year ?? '') && (x.authors[0] ? plain(familyOf(x.authors[0])) : '') === first)));
}

export const newRefId = () => {
  try {
    return `ref-${crypto.randomUUID()}`;
  } catch {
    return `ref-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
};

export type Draft = Omit<LibRef, 'id' | 'key' | 'createdAt' | 'updatedAt' | 'source' | 'verifiedAt' | 'edited'> & { key?: string };

export function addRef(lib: Library, draft: Draft, source: RefSource, now = new Date().toISOString(), id = newRefId()): Library {
  const key = makeKey(draft, new Set(lib.refs.map((r) => r.key)), draft.key);
  const r: LibRef = { ...tidy(draft), id, key, source, createdAt: now, updatedAt: now, ...(source === 'crossref' ? { verifiedAt: now } : {}) };
  return { ...lib, refs: [...lib.refs, r] };
}

/** Changes one reference. A Crossref record changed by the student is marked as edited. The key stays unless changed. */
export function updateRef(lib: Library, id: string, draft: Draft, now = new Date().toISOString()): Library {
  return {
    ...lib,
    refs: lib.refs.map((r) => {
      if (r.id !== id) return r;
      const key = draft.key && draft.key !== r.key ? makeKey(draft, new Set(lib.refs.filter((x) => x.id !== id).map((x) => x.key)), draft.key) : r.key;
      const next = { ...tidy(draft), id, key, source: r.source, createdAt: r.createdAt, updatedAt: now, ...(r.verifiedAt ? { verifiedAt: r.verifiedAt } : {}) } as LibRef;
      const changed = JSON.stringify(fieldsOf(next)) !== JSON.stringify(fieldsOf(r));
      return { ...next, ...(r.source === 'crossref' && (r.edited || changed) ? { edited: true } : {}) };
    }),
  };
}

const fieldsOf = (r: LibRef) => ({ type: r.type, title: r.title, authors: r.authors, year: r.year, container: r.container, volume: r.volume, issue: r.issue, pages: r.pages, publisher: r.publisher, place: r.place, school: r.school, thesisKind: r.thesisKind, doi: r.doi, url: r.url });

export const removeRef = (lib: Library, id: string): Library => ({ ...lib, refs: lib.refs.filter((r) => r.id !== id) });

function tidy(d: Draft): Draft {
  const out: Draft = { type: d.type, title: d.title.trim(), authors: d.authors.filter((a) => familyOf(a).trim()).map((a) => ('literal' in a ? { literal: a.literal.trim() } : { family: a.family.trim(), ...(a.given?.trim() ? { given: a.given.trim() } : {}) })) };
  for (const k of ['year', 'container', 'volume', 'issue', 'pages', 'publisher', 'place', 'school', 'url', 'key'] as const) {
    const v = str(d[k]);
    if (v) out[k] = v;
  }
  const doi = normalizeDoi(d.doi);
  if (doi) out.doi = doi;
  if (d.thesisKind) out.thesisKind = d.thesisKind;
  return out;
}

/** "Smith, John; Lee, K.; 王小明" → people. A name without a comma is kept whole unless it has two Latin words. */
export function parseAuthors(text: string): Person[] {
  return text
    .split(/\s*;\s*|\s+and\s+/i)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      if (s.startsWith('{') && s.endsWith('}')) return { literal: s.slice(1, -1).trim() };
      if (s.includes(',')) {
        const [family, ...given] = s.split(',');
        return { family: family.trim(), given: given.join(',').trim() || undefined };
      }
      if (hasHan(s)) return { literal: s };
      const parts = s.split(/\s+/);
      return parts.length > 1 ? { family: parts.at(-1)!, given: parts.slice(0, -1).join(' ') } : { family: s };
    });
}
export const authorsText = (a: Person[]) => a.map((p) => ('literal' in p ? p.literal : p.given ? `${p.family}, ${p.given}` : p.family)).join('; ');

// ---------- BibTeX ----------

const BIB_TYPES: Record<string, RefType> = {
  article: 'article', book: 'book', inbook: 'chapter', incollection: 'chapter', inproceedings: 'conference', conference: 'conference', proceedings: 'book',
  phdthesis: 'thesis', mastersthesis: 'thesis', thesis: 'thesis', techreport: 'report', report: 'report', online: 'web', electronic: 'web', www: 'web', misc: 'other', unpublished: 'other',
};
const LATEX: [RegExp, string][] = [
  [/\\'\{?([aeiouyAEIOUY])\}?/g, '$1́'], [/\\`\{?([aeiouAEIOU])\}?/g, '$1̀'], [/\\"\{?([aeiouyAEIOUY])\}?/g, '$1̈'], [/\\\^\{?([aeiouAEIOU])\}?/g, '$1̂'],
  [/\\~\{?([anoANO])\}?/g, '$1̃'], [/\\c\{?([cC])\}?/g, '$1̧'], [/\\&/g, '&'], [/\\%/g, '%'], [/\\_/g, '_'], [/--/g, '–'], [/~/g, ' '],
];
const unlatex = (s: string) => LATEX.reduce((t, [re, r]) => t.replace(re, r), s).normalize('NFC').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();

export type BibEntry = { type: string; key: string; fields: Record<string, string> };

/** Reads BibTeX entries. Braces and quotes may nest. Comments, @string and @preamble are skipped. */
export function parseBibtex(src: string): { entries: BibEntry[]; skipped: number } {
  const entries: BibEntry[] = [];
  let skipped = 0;
  let i = 0;
  while ((i = src.indexOf('@', i)) >= 0) {
    const m = /^@(\w+)\s*([{(])/.exec(src.slice(i));
    if (!m) {
      i++;
      continue;
    }
    const type = m[1].toLowerCase();
    const close = m[2] === '{' ? '}' : ')';
    let j = i + m[0].length;
    let depth = 1;
    const start = j;
    for (; j < src.length && depth; j++) {
      if (src[j] === m[2] || (m[2] === '{' && src[j] === '{')) depth++;
      else if (src[j] === close) depth--;
    }
    const body = src.slice(start, j - 1);
    i = j;
    if (['comment', 'string', 'preamble'].includes(type)) continue;
    const comma = body.indexOf(',');
    // A damaged entry (no key, or a key running into the next entry) is skipped, and reading resumes right after it.
    if (comma < 0 || /[\s@{}"]/.test(body.slice(0, comma).trim())) {
      skipped++;
      i = start;
      continue;
    }
    const fields: Record<string, string> = {};
    let k = comma + 1;
    while (k < body.length) {
      const f = /^\s*([\w-]+)\s*=\s*/.exec(body.slice(k));
      if (!f) break;
      k += f[0].length;
      let value = '';
      if (body[k] === '{') {
        let d = 0;
        let e = k;
        for (; e < body.length; e++) {
          if (body[e] === '{') d++;
          else if (body[e] === '}' && --d === 0) break;
        }
        value = body.slice(k + 1, e);
        k = e + 1;
      } else if (body[k] === '"') {
        let d = 0;
        let e = k + 1;
        for (; e < body.length; e++) {
          if (body[e] === '{') d++;
          else if (body[e] === '}') d--;
          else if (body[e] === '"' && d === 0 && body[e - 1] !== '\\') break;
        }
        value = body.slice(k + 1, e);
        k = e + 1;
      } else {
        const v = /^[^,]*/.exec(body.slice(k))![0];
        value = v.trim();
        k += v.length;
      }
      fields[f[1].toLowerCase()] = value;
      const c = body.indexOf(',', k);
      k = c < 0 ? body.length : c + 1;
    }
    entries.push({ type, key: body.slice(0, comma).trim(), fields });
  }
  return { entries, skipped };
}

/** A BibTeX entry as a draft. Only fields the file has are used. */
export function bibToDraft(e: BibEntry): Draft {
  const f = (k: string) => (e.fields[k] !== undefined ? unlatex(e.fields[k]) : undefined) || undefined;
  const type = BIB_TYPES[e.type] ?? 'other';
  const year = f('year') ?? f('date')?.match(/\d{4}/)?.[0];
  // Names in braces are kept whole, like {World Health Organization} or {王小明}.
  const authorField = e.fields.author ?? e.fields.editor ?? '';
  const authors: Person[] = authorField
    .split(/\s+and\s+/i)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      if (/^\{.*\}$/.test(s) && !s.slice(1, -1).includes('{')) return { literal: unlatex(s) };
      const t = unlatex(s);
      if (t.includes(',')) {
        const [family, ...given] = t.split(',');
        return { family: family.trim(), ...(given.join(',').trim() ? { given: given.join(',').trim() } : {}) };
      }
      if (hasHan(t)) return { literal: t };
      const parts = t.split(/\s+/);
      return parts.length > 1 ? { family: parts.at(-1)!, given: parts.slice(0, -1).join(' ') } : { family: t };
    });
  return {
    type,
    key: e.key,
    title: f('title') ?? '',
    authors,
    year,
    container: f('journal') ?? f('journaltitle') ?? f('booktitle') ?? (type === 'web' ? f('organization') : undefined),
    volume: f('volume'),
    issue: f('number') ?? f('issue'),
    pages: f('pages'),
    publisher: f('publisher') ?? f('institution') ?? f('organization'),
    place: f('address') ?? f('location'),
    school: f('school') ?? (type === 'thesis' ? f('institution') : undefined),
    ...(e.type === 'phdthesis' ? { thesisKind: 'phd' as const } : e.type === 'mastersthesis' ? { thesisKind: 'masters' as const } : {}),
    doi: f('doi'),
    url: f('url'),
  };
}

export type ImportResult = { library: Library; added: LibRef[]; duplicates: { entry: string; of: LibRef }[]; skipped: number };

/** Adds every new entry. Entries already in the library are not added twice, and are listed. */
export function importBibtex(lib: Library, src: string, now = new Date().toISOString()): ImportResult {
  const { entries, skipped } = parseBibtex(src);
  let next = lib;
  const added: LibRef[] = [];
  const duplicates: ImportResult['duplicates'] = [];
  for (const e of entries) {
    const d = bibToDraft(e);
    if (!d.title && !d.authors.length) continue;
    const dup = duplicateOf(d, next.refs);
    if (dup) {
      duplicates.push({ entry: e.key || d.title, of: dup });
      continue;
    }
    next = addRef(next, d, 'bibtex', now);
    added.push(next.refs.at(-1)!);
  }
  return { library: next, added, duplicates, skipped: skipped + entries.filter((e) => !bibToDraft(e).title && !bibToDraft(e).authors.length).length };
}

// ---------- Crossref ----------

const CR_TYPES: Record<string, RefType> = {
  'journal-article': 'article', book: 'book', monograph: 'book', 'edited-book': 'book', 'book-chapter': 'chapter', 'book-section': 'chapter', 'book-part': 'chapter',
  'proceedings-article': 'conference', dissertation: 'thesis', report: 'report', 'posted-content': 'other', standard: 'other', dataset: 'other',
};
type CrWork = {
  type?: string; title?: string[]; 'container-title'?: string[]; author?: { family?: string; given?: string; name?: string }[];
  issued?: { 'date-parts'?: (number | null)[][] }; 'published-print'?: { 'date-parts'?: (number | null)[][] }; 'published-online'?: { 'date-parts'?: (number | null)[][] };
  volume?: string; issue?: string; page?: string; publisher?: string; 'publisher-location'?: string; DOI?: string; URL?: string; institution?: { name?: string }[];
};

/** A Crossref record as a draft. Fields Crossref does not have stay empty. */
export function crossrefToDraft(w: CrWork): Draft {
  const type = CR_TYPES[w.type ?? ''] ?? 'other';
  const parts = w.issued?.['date-parts']?.[0]?.[0] ?? w['published-print']?.['date-parts']?.[0]?.[0] ?? w['published-online']?.['date-parts']?.[0]?.[0];
  const t = (s?: string) => s?.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() || undefined;
  return {
    type,
    title: t(w.title?.[0]) ?? '',
    authors: (w.author ?? []).map((a) => (a.family ? { family: a.family.trim(), ...(a.given ? { given: a.given.trim() } : {}) } : { literal: (a.name ?? '').trim() })).filter((a) => familyOf(a)),
    year: typeof parts === 'number' ? String(parts) : undefined,
    container: t(w['container-title']?.[0]),
    volume: t(w.volume),
    issue: t(w.issue),
    pages: t(w.page)?.replace(/-/g, '–'),
    publisher: t(w.publisher),
    place: t(w['publisher-location']),
    school: type === 'thesis' ? t(w.institution?.[0]?.name) : undefined,
    doi: normalizeDoi(w.DOI),
    url: t(w.URL),
  };
}

// ---------- Formatting ----------

/** A piece of formatted text. */
export type Seg = { text: string; italic?: boolean };
const seg = (text: string, italic = false): Seg => ({ text, ...(italic ? { italic } : {}) });
export const segText = (s: Seg[]) => s.map((x) => x.text).join('');
const end = (s: string) => (/[.?!。？！]$/.test(s) ? s : `${s}.`);
const initials = (given: string) => given.split(/[\s-]+/).filter(Boolean).map((g) => `${g[0].toUpperCase()}.`).join(' ');
const isCJK = (p: Person) => hasHan(familyOf(p)) || ('given' in p && !!p.given && hasHan(p.given));
const cjkName = (p: Person) => ('literal' in p ? p.literal : `${p.family}${p.given ?? ''}`);

function apaPerson(p: Person) {
  if ('literal' in p) return p.literal;
  if (isCJK(p)) return cjkName(p);
  return p.given ? `${p.family}, ${initials(p.given)}` : p.family;
}
function apaAuthors(a: Person[]) {
  const names = a.map(apaPerson);
  if (names.length === 1) return names[0];
  if (names.length <= 20) return `${names.slice(0, -1).join(', ')}, & ${names.at(-1)}`;
  return `${names.slice(0, 19).join(', ')}, . . . ${names.at(-1)}`;
}
const doiUrl = (r: LibRef) => (r.doi ? `https://doi.org/${r.doi}` : r.url ?? '');

/** One APA 7 reference-list entry. `suffix` is the a/b letter for the same author and year. */
export function formatApa(r: LibRef, suffix = ''): Seg[] {
  const year = `(${r.year ?? 'n.d.'}${suffix})`;
  const out: Seg[] = [];
  const titleItalic = ['book', 'thesis', 'report', 'web', 'other'].includes(r.type);
  const head = r.authors.length ? [seg(`${end(apaAuthors(r.authors))} ${year}. `)] : [seg(end(r.title), titleItalic), seg(` ${year}. `)];
  out.push(...head);
  if (r.authors.length) {
    if (r.type === 'thesis') out.push(seg(r.title, true), seg(` [${r.thesisKind === 'phd' ? 'Doctoral dissertation' : r.thesisKind === 'masters' ? 'Master’s thesis' : 'Thesis'}${r.school ? `, ${r.school}` : ''}]. `));
    else out.push(seg(end(r.title), titleItalic), seg(' '));
  } else if (r.type === 'thesis') out.push(seg(`[${r.thesisKind === 'phd' ? 'Doctoral dissertation' : r.thesisKind === 'masters' ? 'Master’s thesis' : 'Thesis'}${r.school ? `, ${r.school}` : ''}]. `));
  if (r.type === 'article' && r.container) {
    out.push(seg(r.container, true));
    if (r.volume) out.push(seg(', '), seg(r.volume, true));
    if (r.issue) out.push(seg(`(${r.issue})`));
    if (r.pages) out.push(seg(`, ${r.pages}`));
    out.push(seg('. '));
  } else if ((r.type === 'chapter' || r.type === 'conference') && r.container) {
    out.push(seg('In '), seg(r.container, true), seg(r.pages ? ` (pp. ${r.pages}). ` : '. '));
    if (r.publisher) out.push(seg(`${end(r.publisher)} `));
  } else if (r.publisher && r.type !== 'thesis') out.push(seg(`${end(r.publisher)} `));
  const link = doiUrl(r);
  if (link) out.push(seg(link));
  const all = out.map((s) => ({ ...s, text: s.text })).filter((s) => s.text);
  if (all.length) all[all.length - 1] = { ...all[all.length - 1], text: all[all.length - 1].text.replace(/\s+$/, '') };
  return all;
}

/** The name part of an APA in-text citation: "Smith", "Smith & Lee", "Smith et al.", "王小明等". */
export function apaCiteName(r: LibRef) {
  if (!r.authors.length) return `“${r.title.length > 40 ? `${r.title.slice(0, 40)}…` : r.title}”`;
  const name = (p: Person) => ('literal' in p ? p.literal : isCJK(p) ? cjkName(p) : p.family);
  if (r.authors.length === 1) return name(r.authors[0]);
  if (r.authors.length === 2) return `${name(r.authors[0])} & ${name(r.authors[1])}`;
  return isCJK(r.authors[0]) ? `${name(r.authors[0])}等` : `${name(r.authors[0])} et al.`;
}

const GB_CODES: Record<RefType, string> = { article: 'J', book: 'M', chapter: 'M', conference: 'C', thesis: 'D', report: 'R', web: 'EB/OL', other: 'Z' };
function gbPerson(p: Person) {
  if ('literal' in p) return p.literal;
  if (isCJK(p)) return cjkName(p);
  return `${p.family.toUpperCase()}${p.given ? ` ${p.given.split(/[\s.-]+/).filter(Boolean).map((g) => g[0].toUpperCase()).join(' ')}` : ''}`;
}
function gbAuthors(a: Person[]) {
  const names = a.slice(0, 3).map(gbPerson).join(', ');
  if (a.length <= 3) return names;
  return `${names}, ${isCJK(a[0]) ? '等' : 'et al'}`;
}

/** One GB/T 7714 numeric entry (2015 rules), without its [n] number. */
export function formatGb(r: LibRef): Seg[] {
  const parts: string[] = [];
  if (r.authors.length) parts.push(`${gbAuthors(r.authors)}. `);
  let t = `${r.title}[${GB_CODES[r.type]}]`;
  const place = r.place ?? '[S.l.]';
  const pub = r.publisher ?? '[s.n.]';
  if (r.type === 'article') {
    t += `. ${r.container ?? ''}`.replace(/\. $/, '');
    const vi = `${r.volume ?? ''}${r.issue ? `(${r.issue})` : ''}`;
    t += r.year ? `, ${r.year}` : '';
    if (vi) t += `, ${vi}`;
    if (r.pages) t += `: ${r.pages}`;
  } else if (r.type === 'chapter' || r.type === 'conference') {
    t += r.container ? `//${r.container}` : '';
    t += r.publisher || r.place ? `. ${place}: ${pub}` : '';
    t += r.year ? `${r.publisher || r.place ? ',' : '.'} ${r.year}` : '';
    if (r.pages) t += `: ${r.pages}`;
  } else if (r.type === 'thesis') {
    t += r.school ? `. ${r.place ? `${r.place}: ` : ''}${r.school}` : '';
    t += r.year ? `, ${r.year}` : '';
  } else if (r.type === 'web') {
    t += r.year ? `. (${r.year})` : '';
  } else {
    t += r.publisher || r.place ? `. ${place}: ${pub}` : '';
    t += r.year ? `${r.publisher || r.place ? ',' : '.'} ${r.year}` : '';
  }
  parts.push(`${end(t)}`);
  if (r.url && (r.type === 'web' || !r.doi)) parts.push(` ${r.url}.`);
  if (r.doi) parts.push(` DOI: ${r.doi}.`);
  return [seg(parts.join(''))];
}

// ---------- Citations in the thesis text ----------

/** [@key] or [@key1; @key2], with an optional locator after a comma: [@key, p. 12]. */
export const CITE = /\[@([^\]\s;,]+)((?:\s*,\s*[^;\]]+)?)((?:\s*;\s*@[^\]\s;,]+(?:\s*,\s*[^;\]]+)?)*)\]/g;

export type Cite = { key: string; locator?: string };
export function citesIn(match: string): Cite[] {
  return match
    .slice(1, -1)
    .split(';')
    .map((s) => s.trim())
    .map((s) => /^@([^\s,]+)\s*(?:,\s*(.+))?$/.exec(s))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ key: m[1], ...(m[2] ? { locator: m[2].trim() } : {}) }));
}

/** Every citation key in the order it first appears in these texts. */
export function citationOrder(texts: string[]): string[] {
  const seen: string[] = [];
  for (const t of texts) for (const m of t.matchAll(CITE)) for (const c of citesIn(m[0])) if (!seen.includes(c.key)) seen.push(c.key);
  return seen;
}

export type Bibliography = {
  style: CitationStyle;
  /** Rendered in-text citation for each [@…] group, keyed by the exact text. */
  render: (group: string) => { text: string; superscript: boolean; missing: string[] };
  entries: { ref: LibRef; label: string; segs: Seg[] }[];
  cited: LibRef[];
  uncited: LibRef[];
  missingKeys: string[];
};

const ranges = (nums: number[]) => {
  const s = [...new Set(nums)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(j - i >= 2 ? `${s[i]}–${s[j]}` : j > i ? `${s[i]}, ${s[j]}` : String(s[i]));
    i = j;
  }
  return out.join(', ');
};

/** Builds the bibliography for the texts in order. Only cited references are listed; a missing key stays visible. */
export function buildBibliography(lib: Library, texts: string[], style: CitationStyle = lib.style ?? 'apa7'): Bibliography {
  const byKey = new Map(lib.refs.map((r) => [r.key, r]));
  const order = citationOrder(texts);
  const cited = order.map((k) => byKey.get(k)).filter((r): r is LibRef => !!r);
  const missingKeys = order.filter((k) => !byKey.has(k));
  const uncited = lib.refs.filter((r) => !order.includes(r.key));
  const number = new Map(cited.map((r, i) => [r.key, i + 1]));
  // APA: same name and year get a, b, c by title.
  const suffix = new Map<string, string>();
  if (style === 'apa7') {
    const groups = new Map<string, LibRef[]>();
    for (const r of cited) {
      const k = `${apaCiteName(r)}|${r.year ?? 'n.d.'}`;
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    for (const g of groups.values()) if (g.length > 1) [...g].sort((a, b) => a.title.localeCompare(b.title)).forEach((r, i) => suffix.set(r.key, 'abcdefghijklmnopqrstuvwxyz'[i] ?? String(i)));
  }
  const sortKey = (r: LibRef) => `${r.authors[0] ? apaPerson(r.authors[0]) : r.title}`.toLowerCase();
  const entries =
    style === 'apa7'
      ? [...cited].sort((a, b) => sortKey(a).localeCompare(sortKey(b), 'en') || (a.year ?? '').localeCompare(b.year ?? '') || (suffix.get(a.key) ?? '').localeCompare(suffix.get(b.key) ?? '')).map((r) => ({ ref: r, label: '', segs: formatApa(r, suffix.get(r.key)) }))
      : cited.map((r) => ({ ref: r, label: `[${number.get(r.key)}]`, segs: formatGb(r) }));
  const render = (group: string) => {
    const cs = citesIn(group);
    const missing = cs.filter((c) => !byKey.has(c.key)).map((c) => c.key);
    if (missing.length) return { text: group, superscript: false, missing };
    if (style === 'gbt7714') {
      const loc = cs.length === 1 && cs[0].locator ? `${cs[0].locator}` : '';
      return { text: `[${ranges(cs.map((c) => number.get(c.key)!))}]${loc ? loc.replace(/^p+\.\s*/, '') : ''}`, superscript: true, missing };
    }
    return { text: `(${cs.map((c) => { const r = byKey.get(c.key)!; return `${apaCiteName(r)}, ${r.year ?? 'n.d.'}${suffix.get(r.key) ?? ''}${c.locator ? `, ${c.locator}` : ''}`; }).join('; ')})`, superscript: false, missing };
  };
  return { style, render, entries, cited, uncited, missingKeys };
}
