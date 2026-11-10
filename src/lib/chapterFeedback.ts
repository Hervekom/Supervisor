// Phase P3: chapter feedback history. Each completed AI feedback report is kept inside PathState
// (`chapterFeedback`), so it is saved in this browser and synced to the account like the rest of the work:
// no new table, no new service. A new analysis never replaces an older report: it is added, and the older
// report of the same chapter is only marked as superseded.

import type { Feedback, FeedbackItem } from './feedback';
import { FEEDBACK_LIMIT } from './limits';
import type { PathState } from './path';

/** The existing thesis step where chapters are drafted and reviewed. The 21 step IDs do not change. */
export const FEEDBACK_STEP = 'draft';
/** The saved work must stay below the account's 5 MB limit and fit in browser storage. */
export const MAX_PATH_BYTES = 4_500_000;

export type ReportStatus = 'current' | 'superseded';

/** The chapter as it was when it was analysed. `text` is the part the AI read. */
export type ChapterSnapshot = {
  /** A short fingerprint of the complete chapter text: the same text always gives the same version. */
  version: string;
  text: string;
  totalChars: number;
  words: number;
  file?: string;
};

export type ChapterReport = {
  id: string;
  stepId: string;
  chapter: string;
  /** When the feedback was received, in this browser's clock (ISO). */
  analyzedAt: string;
  snapshot: ChapterSnapshot;
  feedback: Feedback;
  settings: { degree: string; discipline: string; language: string };
  status: ReportStatus;
  /** Same chapter text, same settings and same feedback: a retried response is not stored twice. */
  fingerprint: string;
  /** The request that produced it. "Try again" reuses it, so one request is never saved twice. */
  requestId?: string;
};

/** FNV-1a, twice with different seeds, for a short stable fingerprint. Not a security hash. */
export function fingerprintOf(s: string) {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x01000193 + 2) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

export const chapterKey = (title: string) => title.trim().replace(/\s+/g, ' ').toLowerCase();
export const chapterName = (title: string) => title.trim().replace(/\s+/g, ' ') || 'Untitled chapter';
const words = (t: string) => (t.match(/[\p{Script=Han}]|[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) ?? []).length;

const isReport = (r: unknown): r is ChapterReport => {
  const x = r as ChapterReport;
  return !!x && typeof x === 'object' && typeof x.id === 'string' && typeof x.chapter === 'string' && typeof x.analyzedAt === 'string'
    && !!x.snapshot && typeof x.snapshot.text === 'string' && typeof x.snapshot.version === 'string'
    && !!x.feedback && typeof x.feedback.summary === 'string' && Array.isArray(x.feedback.issues);
};

/** Reports that can be shown, newest first. Older saved copies have none. Unreadable entries are kept in storage, not shown. */
export function reportsOf(p: PathState | null | undefined): ChapterReport[] {
  const raw = Array.isArray(p?.chapterFeedback) ? (p!.chapterFeedback as unknown[]) : [];
  return raw.filter(isReport).sort((a, b) => (a.analyzedAt < b.analyzedAt ? 1 : a.analyzedAt > b.analyzedAt ? -1 : 0));
}

/** The newest report of each chapter is the current one. */
export function latestOf(reports: ChapterReport[], chapter: string) {
  return reports.find((r) => chapterKey(r.chapter) === chapterKey(chapter));
}

export type NewReport = {
  chapter: string;
  text: string;
  file?: string;
  feedback: Feedback;
  settings: { degree: string; discipline: string; language: string };
  requestId?: string;
};

export function buildReport(input: NewReport, now = new Date().toISOString(), id = newId()): ChapterReport {
  const chapter = chapterName(input.chapter);
  const version = fingerprintOf(input.text);
  const settings = { degree: input.settings.degree, discipline: input.settings.discipline.trim(), language: input.settings.language };
  return {
    id,
    stepId: FEEDBACK_STEP,
    chapter,
    analyzedAt: now,
    snapshot: { version, text: input.text.slice(0, FEEDBACK_LIMIT), totalChars: input.text.length, words: words(input.text), ...(input.file ? { file: input.file } : {}) },
    feedback: input.feedback,
    settings,
    status: 'current',
    fingerprint: fingerprintOf(JSON.stringify([chapterKey(chapter), version, settings, input.feedback])),
    ...(input.requestId ? { requestId: input.requestId } : {}),
  };
}

export function newId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export type AddResult =
  | { status: 'added'; path: PathState; report: ChapterReport }
  | { status: 'duplicate'; path: PathState; report: ChapterReport }
  | { status: 'full'; path: PathState; bytes: number };

export const sizeOf = (p: PathState) => new TextEncoder().encode(JSON.stringify(p)).length;

/**
 * Adds a report. Earlier reports keep all their content; only the earlier current report of the same
 * chapter becomes superseded. Unreadable entries already stored are kept as they are.
 * When the saved work would become too large, nothing changes and the student is told.
 */
export function addReport(p: PathState, report: ChapterReport, limit = MAX_PATH_BYTES): AddResult {
  const raw = Array.isArray(p.chapterFeedback) ? (p.chapterFeedback as unknown[]) : [];
  const same = raw.filter(isReport).find((r) => r.fingerprint === report.fingerprint || (!!report.requestId && r.requestId === report.requestId));
  if (same) return { status: 'duplicate', path: p, report: same };
  const key = chapterKey(report.chapter);
  const kept = raw.map((r) => (isReport(r) && r.status === 'current' && chapterKey(r.chapter) === key ? { ...r, status: 'superseded' as const } : r));
  const next: PathState = { ...p, chapterFeedback: [...kept, report] as ChapterReport[] };
  const bytes = sizeOf(next);
  if (bytes > limit) return { status: 'full', path: p, bytes };
  return { status: 'added', path: next, report };
}

/** Removes one report, only when the student asks. The newest remaining report of that chapter becomes current. */
export function removeReport(p: PathState, id: string): PathState {
  const raw = Array.isArray(p.chapterFeedback) ? (p.chapterFeedback as unknown[]) : [];
  const gone = raw.filter(isReport).find((r) => r.id === id);
  if (!gone) return p;
  const rest = raw.filter((r) => !(isReport(r) && r.id === id));
  const key = chapterKey(gone.chapter);
  const newest = rest.filter(isReport).filter((r) => chapterKey(r.chapter) === key).sort((a, b) => (a.analyzedAt < b.analyzedAt ? 1 : -1))[0];
  const fixed = gone.status === 'current' && newest ? rest.map((r) => (r === newest ? { ...newest, status: 'current' as const } : r)) : rest;
  return { ...p, chapterFeedback: fixed as ChapterReport[] };
}

/** A file with every report, for the student to keep. */
export const exportReports = (reports: ChapterReport[], now = new Date().toISOString()) =>
  JSON.stringify({ exportedAt: now, note: 'Your Supervisor chapter feedback history. Each report keeps the chapter text it analysed.', reports }, null, 2);

// ---------- Comparison ----------

const paragraphs = (t: string) => t.split(/\n+/).map((x) => x.trim()).filter(Boolean);
const tokens = (t: string) => new Set(t.toLowerCase().match(/[\p{Script=Han}]|[\p{L}\p{N}]+/gu) ?? []);
function similar(a: string, b: string) {
  const x = tokens(a);
  const y = tokens(b);
  if (!x.size || !y.size) return a.trim().toLowerCase() === b.trim().toLowerCase();
  let both = 0;
  for (const t of x) if (y.has(t)) both++;
  return both / (x.size + y.size - both) >= 0.5;
}

export type Comparison = {
  sameVersion: boolean;
  text: { kept: number; added: string[]; removed: string[]; wordsBefore: number; wordsAfter: number };
  issues: { onlyEarlier: FeedbackItem[]; onlyLater: FeedbackItem[]; both: FeedbackItem[] };
  severities: { earlier: Record<FeedbackItem['severity'], number>; later: Record<FeedbackItem['severity'], number> };
};

const bySeverity = (items: FeedbackItem[]) => ({
  major: items.filter((i) => i.severity === 'major').length,
  moderate: items.filter((i) => i.severity === 'moderate').length,
  minor: items.filter((i) => i.severity === 'minor').length,
});

/** Compares two reports. `a` and `b` are put in date order, so "earlier" is always the older analysis. */
export function compareReports(a: ChapterReport, b: ChapterReport): Comparison & { earlier: ChapterReport; later: ChapterReport } {
  const [earlier, later] = a.analyzedAt <= b.analyzedAt ? [a, b] : [b, a];
  const before = paragraphs(earlier.snapshot.text);
  const after = paragraphs(later.snapshot.text);
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const li = later.feedback.issues;
  const ei = earlier.feedback.issues;
  return {
    earlier,
    later,
    sameVersion: earlier.snapshot.version === later.snapshot.version,
    text: {
      kept: after.filter((x) => beforeSet.has(x)).length,
      added: after.filter((x) => !beforeSet.has(x)),
      removed: before.filter((x) => !afterSet.has(x)),
      wordsBefore: earlier.snapshot.words,
      wordsAfter: later.snapshot.words,
    },
    issues: {
      onlyEarlier: ei.filter((i) => !li.some((j) => similar(i.problem, j.problem))),
      onlyLater: li.filter((j) => !ei.some((i) => similar(i.problem, j.problem))),
      both: li.filter((j) => ei.some((i) => similar(i.problem, j.problem))),
    },
    severities: { earlier: bySeverity(ei), later: bySeverity(li) },
  };
}
