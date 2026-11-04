import { auditThesis, type AuditItem } from './audit';
import type { Doc, Para } from './docx';
import type { Citation, Conflict, DegreeType, Profile, Rule } from './types';

export type Status = 'pass' | 'fail' | 'review' | 'manual' | 'skipped';

export type Result = {
  ruleId: string;
  key: string;
  category: string;
  severity: Rule['severity'];
  status: Status;
  title: string;
  detail: string;
  examples: string[];
  source: Citation;
  ruleStatus: Rule['status'];
};

export type ConflictResult = {
  id: string;
  topic: string;
  observed: string | null;
  provisional: string | null;
  provisionalReason: string | null;
  options: { value: string; source: Citation }[];
};

export type Report = {
  profileId: string;
  degree: DegreeType;
  mode: 'final' | 'blind';
  stats: { mainWords: number; paragraphs: number; tables: number; references: number };
  results: Result[];
  conflicts: ConflictResult[];
  audit: AuditItem[];
  aiPolicy: Profile['ai_policy'];
};

export type Options = { degree: DegreeType; mode: 'final' | 'blind'; names?: string[] };

type Part =
  | 'originality'
  | 'abstract_en'
  | 'abstract_zh'
  | 'table_of_contents'
  | 'main_body'
  | 'conclusion'
  | 'references'
  | 'appendices'
  | 'index'
  | 'research_outputs'
  | 'acknowledgments';

const PART_PATTERNS: [Part, RegExp][] = [
  ['originality', /^(原创性声明|originality statement|statement of originality)$/i],
  ['abstract_en', /^abstract$/i],
  ['abstract_zh', /^摘\s*要$/],
  ['table_of_contents', /^(table of )?contents$|^目\s*录$/i],
  ['conclusion', /^conclusions?$/i],
  ['references', /^(references?|bibliography|参考文献)$/i],
  ['appendices', /^appendi(x|ces)\b.{0,30}$/i],
  ['index', /^index$/i],
  ['research_outputs', /^research outputs?\b.*$/i],
  ['acknowledgments', /^(acknowledge?ments?|致\s*谢)$/i],
];

const CAPTION = /^(figure|fig\.?|table)\s*\d+\s*[-.–]\s*\d+/i;
const FIRST_CHAPTER = /^chapter\s+(1|i|one)\b/i;

export type Layout = {
  parts: Map<Part, number>;
  main: Para[];
  bodyParas: Para[];
  references: Para[];
  abstractEn: Para[];
  abstractZh: Para[];
  chapters: { title: string; start: number; end: number }[];
};

export function layoutOf(doc: Doc): Layout {
  const ps = doc.paragraphs;
  const parts = new Map<Part, number>();
  for (const p of ps) {
    if (p.isToc || p.tableIndex !== null || !p.text || p.text.length > 90) continue;
    // A table of contents line ends with a page number, so it never matches.
    for (const [part, re] of PART_PATTERNS) {
      if (re.test(p.text)) parts.set(part, p.index); // last match wins: real parts follow any manual contents list
    }
    if (FIRST_CHAPTER.test(p.text) && !/\s\d+$/.test(p.text)) {
      if (!parts.has('main_body')) parts.set('main_body', p.index);
    }
  }
  const after = (from: number) => {
    const next = [...parts.values()].filter((v) => v > from).sort((a, b) => a - b)[0];
    return next ?? ps.length;
  };
  const mainStart = parts.get('main_body');
  const endMarks = (['references', 'appendices', 'research_outputs', 'acknowledgments'] as Part[])
    .map((k) => parts.get(k))
    .filter((v): v is number => v !== undefined && (mainStart === undefined || v > mainStart));
  const mainEnd = endMarks.length ? Math.min(...endMarks) : ps.length;
  const main = mainStart === undefined ? [] : ps.slice(mainStart, mainEnd);
  const bodyParas = main.filter(
    (p) => p.tableIndex === null && !p.level && !p.isToc && p.text.length >= 80 && !CAPTION.test(p.text),
  );
  const refStart = parts.get('references');
  const references = refStart === undefined ? [] : ps.slice(refStart + 1, after(refStart)).filter((p) => p.text);
  const slice = (k: Part) => {
    const s = parts.get(k);
    return s === undefined ? [] : ps.slice(s + 1, after(s)).filter((p) => p.text && p.tableIndex === null);
  };

  const heads = main.filter((p) => p.text && (p.level === 1 || (/^chapter\s+\S+/i.test(p.text) && p.text.length < 130 && p.level > 0)));
  const concl = parts.get('conclusion');
  const chapters = heads
    .filter((h) => !/^conclusions?$/i.test(h.text))
    .map((h, i, a) => ({
      title: h.text,
      start: h.index,
      end: a[i + 1]?.index ?? (concl !== undefined && concl > h.index ? concl : mainEnd),
    }));
  return { parts, main, bodyParas, references, abstractEn: slice('abstract_en'), abstractZh: slice('abstract_zh'), chapters };
}

export const excerpt = (t: string, n = 80) => (t.length > n ? `${t.slice(0, n).trimEnd()}…` : t);
export const countEnglishWords = (t: string) => (t.match(/[A-Za-z0-9][A-Za-z0-9'’\-]*/g) ?? []).length;
const countHan = (t: string) => (t.match(/\p{Script=Han}/gu) ?? []).length;
const near = (a: number | null, b: number, tol = 0.11) => a !== null && Math.abs(a - b) <= tol;
const sameFont = (a: string | null, b: string) => !!a && a.toLowerCase() === b.toLowerCase();

type Spec = { font?: string; size_pt?: number; bold?: boolean; align?: string; line_spacing?: number; first_line_indent?: boolean };

function specMisses(p: Para, s: Spec): string[] {
  const miss: string[] = [];
  if (s.font && !sameFont(p.font, s.font)) miss.push(`font is ${p.font ?? 'not set'}`);
  if (s.size_pt !== undefined && !near(p.sizePt, s.size_pt)) miss.push(`size is ${p.sizePt ?? 'not set'} pt`);
  if (s.bold !== undefined && p.bold !== s.bold) miss.push(s.bold ? 'not bold' : 'bold');
  if (s.align && p.align !== s.align) miss.push(`aligned ${p.align}`);
  if (s.line_spacing !== undefined && !near(p.lineSpacing, s.line_spacing, 0.03)) miss.push(`line spacing is ${p.lineSpacing ?? 'not set'}`);
  if (s.first_line_indent && !p.firstLineIndent) miss.push('no first-line indent');
  return miss;
}

type Outcome = { status: Status; detail: string; examples?: string[] };
type Ctx = { doc: Doc; layout: Layout; opts: Options; rule: Rule };
type Check = (c: Ctx) => Outcome;

const ok = (detail: string): Outcome => ({ status: 'pass', detail });
const fail = (detail: string, examples: string[] = []): Outcome => ({ status: 'fail', detail, examples });
const review = (detail: string, examples: string[] = []): Outcome => ({ status: 'review', detail, examples });
const noData = (what: string): Outcome => ({ status: 'skipped', detail: `Not checked: ${what}.` });

function specCheck(paras: (c: Ctx) => Para[], what: string): Check {
  return (c) => {
    const list = paras(c);
    if (!list.length) return noData(`no ${what} found`);
    const s = c.rule.value as Spec;
    const bad = list.map((p) => ({ p, m: specMisses(p, s) })).filter((x) => x.m.length);
    if (!bad.length) return ok(`All ${list.length} ${what} match.`);
    return fail(
      `${bad.length} of ${list.length} ${what} differ.`,
      bad.slice(0, 3).map((b) => `“${excerpt(b.p.text, 56)}”: ${b.m.join(', ')}`),
    );
  };
}

const headings = (lvl: number) => (c: Ctx) => c.layout.main.filter((p) => p.level === lvl && p.text);
const captions = (c: Ctx) => c.layout.main.filter((p) => CAPTION.test(p.text) && p.tableIndex === null);
const bodySection = (c: Ctx) => {
  const first = c.layout.bodyParas[0] ?? c.layout.main[0];
  return first ? c.doc.sections[first.section] ?? null : c.doc.sections[c.doc.sections.length - 1] ?? null;
};

function marginCheck(wantHeader: boolean): Check {
  return (c) => {
    const s = bodySection(c);
    if (!s) return noData('no page setup found');
    if (s.hasHeader !== wantHeader) return { status: 'skipped', detail: wantHeader ? 'The main body has no header, so the no-header margins apply.' : 'The main body has a header, so the header margins apply.' };
    const v = c.rule.value as Record<'top' | 'bottom' | 'left' | 'right', number>;
    const bad = (Object.keys(v) as (keyof typeof v)[]).filter((k) => Math.abs(s.margins[k] - v[k]) > 0.06);
    if (!bad.length) return ok('Main body margins match.');
    return fail('Main body margins differ.', bad.map((k) => `${k} is ${s.margins[k]} cm, required ${v[k]} cm`));
  };
}

function keywords(layout: Layout, en: boolean) {
  const list = en ? layout.abstractEn : layout.abstractZh;
  const p = list.find((x) => /^(key\s*words?|关\s*键\s*词)\s*[:：]/i.test(x.text));
  if (!p) return null;
  const body = p.text.replace(/^[^:：]*[:：]\s*/, '');
  return { para: p, body, items: body.split(/[;；,，]/).map((s) => s.trim()).filter(Boolean) };
}

const citeTokens = (t: string) => [...t.matchAll(/\[(\d+(?:\s*[-–,]\s*\d+)*)\]/g)].map((m) => m[1]);
function expand(token: string): number[] {
  const out: number[] = [];
  for (const part of token.split(',')) {
    const [a, b] = part.split(/[-–]/).map((x) => Number(x.trim()));
    if (b === undefined) out.push(a);
    else for (let i = a; i <= b && i - a < 500; i++) out.push(i);
  }
  return out;
}

const refAuthors = (t: string) => t.replace(/^\[\d+\]\s*/, '').split(/\.\s/)[0];

const CHECKS: Record<string, Check> = {
  'format.page_size': (c) => {
    const bad = c.doc.sections.filter((s) => Math.abs(s.widthCm - 21) > 0.1 || Math.abs(s.heightCm - 29.7) > 0.1);
    return bad.length ? fail(`${bad.length} document section(s) are not A4.`, bad.slice(0, 3).map((s) => `${s.widthCm} × ${s.heightCm} cm`)) : ok('All pages are A4.');
  },
  'format.body_text': specCheck((c) => c.layout.bodyParas, 'body paragraphs'),
  'format.heading.level1': specCheck(headings(1), 'chapter headings'),
  'format.heading.level2': specCheck(headings(2), 'section headings'),
  'format.heading.level3': specCheck(headings(3), 'subsection headings'),
  'format.captions': specCheck(captions, 'captions'),
  'format.table_text': specCheck((c) => c.doc.paragraphs.filter((p) => p.tableIndex !== null && p.text && p.index >= (c.layout.main[0]?.index ?? 0)), 'table cells'),
  'format.margins_cm.with_header': marginCheck(true),
  'format.margins_cm.without_header': marginCheck(false),
  'format.header.odd_pages': (c) => {
    const s = bodySection(c);
    if (!s) return noData('no page setup found');
    if (!c.doc.evenOddHeaders) return fail('Different headers for odd and even pages are turned off.');
    return s.headerTexts.filter(Boolean).length >= 2 ? review('Odd and even headers exist. Check the wording on a printed page.') : fail('The main body needs both an odd and an even page header.');
  },
  'format.page_numbers.main': (c) => {
    const s = bodySection(c);
    if (!s) return noData('no page setup found');
    if (s.pageNumberFormat && s.pageNumberFormat !== 'decimal') return fail(`Main body page numbers use ${s.pageNumberFormat}.`);
    if (s.pageNumberStart !== 1) return review('The main body does not explicitly restart at page 1. Check the first chapter page.');
    return ok('Main body numbering starts at 1 in Arabic numerals.');
  },
  'format.page_numbers.front': (c) => {
    const first = c.layout.main[0];
    if (!first) return noData('main body not found');
    const front = c.doc.sections.filter((s) => s.index < first.section);
    if (!front.length) return fail('Front matter and main body share one section, so they cannot use separate numbering.');
    return front.some((s) => s.pageNumberFormat === 'upperRoman') ? ok('Front matter uses uppercase Roman numerals.') : fail('No front matter section uses uppercase Roman numerals.');
  },
  'format.figure_numbering': (c) => {
    const figs = c.doc.paragraphs.filter((p) => /^(figure|fig\.?)\s*\d+\s*[.–-]\s*\d+/i.test(p.text) && !p.isToc && p.tableIndex === null);
    if (!figs.length) return noData('no figure captions found');
    const bad = figs.filter((p) => !/^Figure \d+-\d+/.test(p.text));
    return bad.length ? fail(`${bad.length} of ${figs.length} figure labels use another format.`, bad.slice(0, 3).map((p) => excerpt(p.text, 60))) : ok(`All ${figs.length} figure labels match.`);
  },
  'format.figure_caption_position': (c) => {
    const figs = c.layout.main.filter((p) => /^(figure|fig\.?)\s*\d/i.test(p.text) && p.tableIndex === null);
    if (!figs.length) return noData('no figure captions found');
    const ps = c.doc.paragraphs;
    const bad = figs.filter((p) => !ps.slice(Math.max(0, p.index - 3), p.index).some((x) => x.hasImage) || p.align !== 'center');
    return bad.length ? review(`${bad.length} of ${figs.length} captions may not be centered below a figure.`, bad.slice(0, 3).map((p) => excerpt(p.text, 60))) : ok('Figure captions sit centered below figures.');
  },
  'format.table_caption_position': (c) => {
    const mainStart = c.layout.main[0]?.index ?? 0;
    const tables = c.doc.tables.filter((t) => t.paragraphIndex > mainStart);
    if (!tables.length) return noData('no tables found');
    const ps = c.doc.paragraphs;
    const bad = tables.filter((t) => !ps.slice(Math.max(0, t.paragraphIndex - 3), t.paragraphIndex).some((p) => /^table\s*\d/i.test(p.text)));
    return bad.length ? review(`${bad.length} of ${tables.length} tables have no table title directly above.`) : ok('Table titles sit above their tables.');
  },
  'format.table_style': (c) => {
    const mainStart = c.layout.main[0]?.index ?? 0;
    const tables = c.doc.tables.filter((t) => t.paragraphIndex > mainStart);
    if (!tables.length) return noData('no tables found');
    const bad = tables.filter((t) => t.hasVerticalBorders);
    return bad.length ? review(`${bad.length} of ${tables.length} tables appear to have vertical borders.`) : review('No vertical borders were found in table settings. Borders set through a table style need a visual check.');
  },
  'format.table_empty_cell': (c) => {
    const mainStart = c.layout.main[0]?.index ?? 0;
    const tables = c.doc.tables.filter((t) => t.paragraphIndex > mainStart);
    if (!tables.length) return noData('no tables found');
    const n = tables.reduce((a, t) => a + t.rows.flat().filter((x) => !x).length, 0);
    return n ? fail(`${n} table cell(s) are empty. Fill them with an em dash.`) : ok('No empty table cells.');
  },
  'length.main_text.min_words': (c) => {
    if (!c.layout.main.length) return noData('main body not found');
    const words = countEnglishWords(c.layout.main.filter((p) => p.tableIndex === null).map((p) => p.text).join(' '));
    const min = c.rule.value as number;
    return words >= min ? ok(`Main text has about ${words.toLocaleString('en')} words.`) : fail(`Main text has about ${words.toLocaleString('en')} words. ${(min - words).toLocaleString('en')} more are needed.`);
  },
  'length.abstract_local.characters': (c) => {
    const n = countHan(c.layout.abstractZh.filter((p) => !/^关\s*键\s*词/.test(p.text)).map((p) => p.text).join(''));
    if (!n) return noData('no Chinese abstract text found');
    const { min, max } = c.rule.value as { min: number; max: number };
    return n >= min && n <= max ? ok(`Chinese abstract has ${n} characters.`) : review(`Chinese abstract has ${n} characters. The usual range is ${min}–${max}.`);
  },
  'abstract.keywords_count': (c) => {
    const k = keywords(c.layout, true) ?? keywords(c.layout, false);
    if (!k) return fail('No keywords line was found after the abstract.');
    const { min, max } = c.rule.value as { min: number; max: number };
    return k.items.length >= min && k.items.length <= max ? ok(`${k.items.length} keywords found.`) : fail(`${k.items.length} keywords found. Use ${min}–${max}.`, [excerpt(k.body)]);
  },
  'heading.chapter_title.max_words': (c) => {
    const max = c.rule.value as number;
    const bad = headings(1)(c).filter((p) => p.text.replace(/^chapter\s+\S+\s*/i, '').split(/\s+/).filter(Boolean).length > max);
    return bad.length ? review(`${bad.length} chapter title(s) exceed ${max} words.`, bad.slice(0, 3).map((p) => excerpt(p.text, 70))) : ok('Chapter titles are within the limit.');
  },
  'language.abstract': (c) => {
    const miss = [!c.layout.parts.has('abstract_en') && 'English abstract', !c.layout.parts.has('abstract_zh') && 'Chinese abstract'].filter(Boolean);
    return miss.length ? fail(`Missing: ${miss.join(', ')}.`) : ok('Both abstracts are present.');
  },
  'structure.parts_order': (c) => {
    const expected = (c.rule.value as string[]).filter((x) => !x.endsWith('?'));
    const map: Record<string, Part[]> = {
      originality_and_authorization: ['originality'],
      abstracts: ['abstract_en', 'abstract_zh'],
      table_of_contents: ['table_of_contents'],
      main_body: ['main_body'],
      references: ['references'],
      research_outputs: ['research_outputs'],
      acknowledgments: c.opts.mode === 'blind' ? [] : ['acknowledgments'],
    };
    const missing: string[] = [];
    const seq: { name: string; at: number }[] = [];
    for (const name of expected) {
      if (name === 'cover') continue;
      const pos = (map[name] ?? []).map((p) => c.layout.parts.get(p)).filter((v): v is number => v !== undefined);
      if ((map[name] ?? []).length && !pos.length) missing.push(name.replaceAll('_', ' '));
      if (pos.length) seq.push({ name, at: Math.min(...pos) });
    }
    const swapped = seq.filter((s, i) => i > 0 && s.at < seq[i - 1].at).map((s) => s.name.replaceAll('_', ' '));
    if (missing.length || swapped.length) return fail([missing.length && `Missing: ${missing.join(', ')}.`, swapped.length && `Out of order: ${swapped.join(', ')}.`].filter(Boolean).join(' '));
    return ok('Required parts are present and in order.');
  },
  'structure.chapter_starts_new_page': (c) => {
    const bad = headings(1)(c).filter((p) => !p.breakBefore);
    return bad.length ? review(`${bad.length} chapter(s) may not start on a new page.`, bad.slice(0, 3).map((p) => excerpt(p.text, 60))) : ok('Chapters start on a new page.');
  },
  'structure.chapter_summary_required': (c) => {
    if (!c.layout.chapters.length) return noData('no chapters found');
    const miss = c.layout.chapters.filter((ch) => !c.doc.paragraphs.slice(ch.start, ch.end).some((p) => p.level >= 2 && /summary/i.test(p.text)));
    return miss.length ? review(`${miss.length} of ${c.layout.chapters.length} chapters have no “Chapter Summary” heading.`, miss.slice(0, 3).map((m) => excerpt(m.title, 60))) : ok('Every chapter has a summary section.');
  },
  'structure.conclusion_unnumbered': (c) => {
    const numbered = c.doc.paragraphs.filter((p) => !p.isToc && /^chapter\s+\S+\s+conclusions?\b/i.test(p.text) && !/\s\d+$/.test(p.text));
    if (numbered.length) return fail('The conclusion has a chapter number.', [excerpt(numbered[0].text)]);
    return c.layout.parts.has('conclusion') ? ok('The conclusion is an unnumbered chapter.') : review('No conclusion heading was found. A discussion section is allowed only when no conclusion can be drawn.');
  },
  'structure.recommended_heading_levels': (c) => {
    const deep = c.layout.main.filter((p) => p.level > (c.rule.value as number));
    return deep.length ? review(`${deep.length} heading(s) sit below the recommended depth.`, deep.slice(0, 2).map((p) => excerpt(p.text, 60))) : ok('Heading depth is within the recommendation.');
  },
  'citation.in_text_system': (c) => {
    if (!c.layout.bodyParas.length) return noData('no body text found');
    const text = c.layout.bodyParas.map((p) => p.text).join(' ');
    const num = citeTokens(text).length;
    const ay = (text.match(/\([A-Z][A-Za-z'’-]+(?: et al\.?| (?:and|&) [A-Z][A-Za-z'’-]+)?,? (?:19|20)\d{2}[a-z]?\)/g) ?? []).length;
    if (ay > 0 && ay >= num / 4) return fail(`${ay} author-year citation(s) found. This profile requires numbered citations.`);
    return num ? ok(`${num} numbered citations found.`) : review('No numbered citations were found in the body text.');
  },
  'citation.numbering_options': (c) => {
    const seen: number[] = [];
    for (const p of c.layout.bodyParas) for (const t of citeTokens(p.text)) for (const n of expand(t)) if (!seen.includes(n)) seen.push(n);
    if (seen.length < 2) return noData('too few citations');
    const entries = c.layout.references;
    const sequential = seen.every((n, i) => i === 0 || n > seen[i - 1]);
    const listed = new Set<number>();
    entries.forEach((p, i) => {
      const n = p.text.match(/^\[(\d+)\]/)?.[1];
      listed.add(n ? Number(n) : i + 1);
    });
    const missing = seen.filter((n) => !listed.has(n));
    const unused = [...listed].filter((n) => !seen.includes(n));
    const msgs = [missing.length && `Cited but not listed: ${missing.slice(0, 8).join(', ')}.`, unused.length && `Listed but not cited: ${unused.slice(0, 8).join(', ')}.`].filter(Boolean) as string[];
    if (msgs.length) return fail(msgs.join(' '));
    if (sequential) return ok('Citations follow order of appearance and match the list.');
    const surnames = entries.map((p) => refAuthors(p.text).toLowerCase());
    return surnames.every((s, i) => i === 0 || s >= surnames[i - 1]) ? ok('The list follows alphabetical order and matches the citations.') : fail('Citations follow neither order of appearance nor alphabetical order.');
  },
  'citation.standard': (c) => {
    if (!c.layout.references.length) return noData('no reference list found');
    const typed = c.layout.references.filter((p) => /\[[A-Z]{1,2}(\/[A-Z]{2})?\]/.test(p.text.replace(/^\[\d+\]/, '')));
    const bad = c.layout.references.filter((p) => !typed.includes(p));
    return bad.length ? review(`${bad.length} of ${c.layout.references.length} entries have no document type code such as [J] or [C].`, bad.slice(0, 3).map((p) => excerpt(p.text, 70))) : review('Every entry has a document type code. Field order still needs a check.');
  },
  'citation.max_listed_authors': (c) => {
    if (!c.layout.references.length) return noData('no reference list found');
    const max = c.rule.value as number;
    const bad = c.layout.references.filter((p) => {
      const a = refAuthors(p.text);
      return !/et al/i.test(a) && a.split(',').length > max;
    });
    return bad.length ? fail(`${bad.length} entries list more than ${max} authors without “et al.”`, bad.slice(0, 3).map((p) => excerpt(p.text, 70))) : ok('Author lists are within the limit.');
  },
  'citation.entry_trailing_punctuation': (c) => {
    if (!c.layout.references.length) return noData('no reference list found');
    const bad = c.layout.references.filter((p) => /[.,;:。，；]$/.test(p.text));
    return bad.length ? fail(`${bad.length} of ${c.layout.references.length} entries end with punctuation.`, bad.slice(0, 3).map((p) => `…${p.text.slice(-50)}`)) : ok('No entry ends with punctuation.');
  },
  'citation.page_numbers_required': (c) => {
    const journals = c.layout.references.filter((p) => /\[J\]/.test(p.text));
    if (!journals.length) return noData('no journal entries found');
    const bad = journals.filter((p) => !/:\s*(e|E)?\d+/.test(p.text));
    return bad.length ? review(`${bad.length} of ${journals.length} journal entries may lack page numbers.`, bad.slice(0, 3).map((p) => excerpt(p.text, 70))) : ok('Journal entries include page numbers.');
  },
  'anonymity.acknowledgments_removed': (c) => (c.layout.parts.has('acknowledgments') ? fail('The acknowledgments section is still in the file.') : ok('No acknowledgments section found.')),
  'anonymity.identity_clues_removed': (c) => {
    const names = (c.opts.names ?? []).map((n) => n.trim()).filter((n) => n.length >= 2);
    if (!names.length) return review('Enter the names of the student and supervisor to search for them.');
    const hits = c.doc.paragraphs.filter((p) => names.some((n) => p.text.toLowerCase().includes(n.toLowerCase())));
    const inHeaders = c.doc.sections.some((s) => s.headerTexts.some((t) => names.some((n) => t.toLowerCase().includes(n.toLowerCase()))));
    if (hits.length || inHeaders) return fail(`Names were found in ${hits.length} paragraph(s)${inHeaders ? ' and in a page header' : ''}.`, hits.slice(0, 3).map((p) => excerpt(p.text, 70)));
    return review('The names you entered were not found. Check file properties and funded project numbers by hand.');
  },
  'anonymity.cover_names_removed': (c) => {
    const first = c.layout.parts.get('originality') ?? c.layout.parts.get('abstract_en') ?? 60;
    const cover = c.doc.paragraphs.slice(0, first);
    const bad = cover.filter((p) => /^(candidate|supervisor|applicant|申请人姓名|指\s*导\s*教\s*师|student id|学\s*号)\s*[:：]\s*\S+/i.test(p.text) && !/^(…|\.|_|x)+$/i.test(p.text.replace(/^[^:：]*[:：]\s*/, '')));
    return bad.length ? fail('Filled-in identity fields remain on the cover.', bad.slice(0, 3).map((p) => excerpt(p.text, 60))) : review('No filled-in name fields were found on the cover. Confirm this on the page.');
  },
};

const OUTPUT_ANON = new Set(['anonymity.cover_names_removed', 'anonymity.statements_unsigned', 'anonymity.identity_clues_removed', 'anonymity.research_outputs_masked', 'anonymity.acknowledgments_removed', 'anonymity.confidentiality_declared']);

const TITLES: Record<string, string> = {
  'format.page_size': 'Page size',
  'format.body_text': 'Body text format',
  'format.heading.level1': 'Chapter headings',
  'format.heading.level2': 'Section headings',
  'format.heading.level3': 'Subsection headings',
  'format.captions': 'Caption format',
  'format.table_text': 'Table text',
  'format.margins_cm.with_header': 'Margins with header',
  'format.margins_cm.without_header': 'Margins without header',
  'format.header.odd_pages': 'Page headers',
  'format.page_numbers.main': 'Main page numbers',
  'format.page_numbers.front': 'Front matter page numbers',
  'format.figure_numbering': 'Figure numbering',
  'format.figure_caption_position': 'Figure captions',
  'format.table_caption_position': 'Table titles',
  'format.table_style': 'Table style',
  'format.table_empty_cell': 'Empty table cells',
  'length.main_text.min_words': 'Main text length',
  'length.abstract_local.characters': 'Chinese abstract length',
  'abstract.keywords_count': 'Keywords',
  'heading.chapter_title.max_words': 'Chapter title length',
  'language.abstract': 'Abstract languages',
  'structure.parts_order': 'Required parts',
  'structure.chapter_starts_new_page': 'Chapter page breaks',
  'structure.chapter_summary_required': 'Chapter summaries',
  'structure.conclusion_unnumbered': 'Conclusion chapter',
  'structure.recommended_heading_levels': 'Heading depth',
  'citation.in_text_system': 'Citation system',
  'citation.numbering_options': 'Citations and reference list',
  'citation.standard': 'Reference format',
  'citation.max_listed_authors': 'Author lists',
  'citation.entry_trailing_punctuation': 'Reference punctuation',
  'citation.page_numbers_required': 'Reference page numbers',
  'anonymity.acknowledgments_removed': 'Acknowledgments removed',
  'anonymity.identity_clues_removed': 'Names removed',
  'anonymity.cover_names_removed': 'Cover anonymized',
};

const humanize = (k: string) => {
  const s = k.split('.').slice(1).join(' ').replaceAll('_', ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const show = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));

function observeConflict(c: Conflict, layout: Layout): string | null {
  if (c.key === 'abstract.keyword_separator') {
    const k = keywords(layout, true);
    if (!k) return null;
    return k.body.includes(';') || k.body.includes('；') ? 'Your file uses semicolons.' : /[,，]/.test(k.body) ? 'Your file uses commas.' : null;
  }
  if (c.key === 'heading.chapter_number_style') {
    const h = layout.main.find((p) => /^chapter\s+\S+/i.test(p.text));
    return h ? `Your file uses “${excerpt(h.text, 40)}”.` : null;
  }
  if (c.key === 'structure.abstract_order') {
    const en = layout.parts.get('abstract_en');
    const zh = layout.parts.get('abstract_zh');
    if (en === undefined || zh === undefined) return null;
    return en < zh ? 'Your file puts the English abstract first.' : 'Your file puts the Chinese abstract first.';
  }
  return null;
}

export function checkDocument(doc: Doc, profile: Profile, opts: Options): Report {
  const layout = layoutOf(doc);
  const results: Result[] = [];
  for (const rule of profile.rules) {
    if (rule.applies_to.length && !rule.applies_to.includes(opts.degree)) continue;
    const isAnon = OUTPUT_ANON.has(rule.key);
    if (isAnon && opts.mode !== 'blind') continue;
    const fn = CHECKS[rule.key];
    const out: Outcome = fn
      ? fn({ doc, layout, opts, rule })
      : { status: 'manual', detail: rule.note ?? `Requirement: ${show(rule.value)}${rule.unit ? ` ${rule.unit}` : ''}.` };
    let status = out.status;
    // Assisted rules are never a final verdict from software alone.
    if (rule.enforcement === 'assisted' && status === 'pass') status = 'review';
    results.push({
      ruleId: rule.id,
      key: rule.key,
      category: rule.category,
      severity: rule.severity,
      status,
      title: TITLES[rule.key] ?? humanize(rule.key),
      detail: out.detail,
      examples: out.examples ?? [],
      source: rule.source,
      ruleStatus: rule.status,
    });
  }
  const conflicts: ConflictResult[] = profile.conflicts
    .filter((c) => c.status === 'open' && (!c.applies_to?.length || c.applies_to.includes(opts.degree)))
    .map((c) => ({
      id: c.id,
      topic: c.topic,
      observed: observeConflict(c, layout),
      provisional: c.provisional_option !== undefined ? show(c.options[c.provisional_option].value) : null,
      provisionalReason: c.provisional_reason ?? null,
      options: c.options.map((o) => ({ value: show(o.value), source: o.source })),
    }));
  const concl = layout.parts.get('conclusion');
  const mainText = layout.main.filter((p) => p.tableIndex === null).map((p) => p.text);
  const lastChapter = layout.chapters[layout.chapters.length - 1];
  const closingFrom = concl ?? lastChapter?.start ?? doc.paragraphs.length;
  const refStart = layout.parts.get('references') ?? doc.paragraphs.length;
  const closing = doc.paragraphs.slice(closingFrom, refStart).map((p) => p.text).join(' ');
  const discussion = layout.main.filter((p) => /discussion|limitations?/i.test(p.text) && p.level > 0).length ? mainText.join(' ').slice(-20000) : '';
  const audit = auditThesis({
    abstractEn: layout.abstractEn.map((p) => p.text).join(' '),
    abstractOther: layout.abstractZh.map((p) => p.text).join(' '),
    body: mainText.join(' '),
    closing: `${discussion} ${closing}`,
    references: layout.references.map((p) => p.text),
  });
  return {
    profileId: profile.profile_id,
    degree: opts.degree,
    mode: opts.mode,
    stats: {
      mainWords: countEnglishWords(layout.main.filter((p) => p.tableIndex === null).map((p) => p.text).join(' ')),
      paragraphs: doc.paragraphs.length,
      tables: doc.tables.length,
      references: layout.references.length,
    },
    results,
    conflicts,
    audit,
    aiPolicy: profile.ai_policy,
  };
}

export function chaptersOf(doc: Doc) {
  const l = layoutOf(doc);
  return l.chapters.map((c) => ({
    title: c.title,
    text: doc.paragraphs.slice(c.start, c.end).filter((p) => p.text).map((p) => p.text).join('\n'),
  }));
}

export function referencesOf(doc: Doc) {
  return layoutOf(doc).references.map((p) => p.text);
}
