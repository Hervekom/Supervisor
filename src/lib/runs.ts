// Experiment run records that the student reports by hand. Stored inside PathState, so no database change.
// Supervisor never runs anything and never invents a number: every value here was typed or imported by the student.

import { fill, STEP_TITLES_FR, t, type Lang } from './i18n';
import { findSensitive, type Sensitive } from './labVerify';
import { identityWords, redactIdentity, redactPii } from './pii';
import type { LabState } from './lab';
import { STEPS } from './path';

export const SOURCE_LABEL = 'Reported by the student';
export const MAX_RUNS = 40;
export const MAX_METRICS = 40;
export const MAX_LOG = 2000;
export const MAX_METRICS_FILE = 50_000;
const LIMITS = { name: 80, purpose: 400, dataset: 200, split: 200, model: 200, settings: 1500, seeds: 200, versions: 600, hardware: 300, duration: 80, notes: 1500, metricName: 60, metricNote: 120 };

export const SPLITS = ['test', 'validation', 'train', 'other'] as const;
export type Split = (typeof SPLITS)[number];
export type Metric = { name: string; value: number; split: Split; note?: string };
export type RunStep = 'experiments' | 'research';
export type RunOutcome = 'completed' | 'failed';

export type RunRecord = {
  id: string;
  source: 'student';
  step: RunStep;
  /** The thesis step this run belongs to. Optional: older runs and unassigned runs have none. */
  stepId?: string;
  outcome: RunOutcome;
  name: string;
  purpose: string;
  dataset: string;
  split: string;
  model: string;
  settings: string;
  seeds: string;
  versions: string;
  hardware: string;
  duration: string;
  metrics: Metric[];
  log: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  /** When the student copied it into the results sheet. */
  addedToSheet?: string;
};

export type RunDraft = Omit<RunRecord, 'id' | 'source' | 'createdAt' | 'updatedAt' | 'addedToSheet'>;

export const emptyDraft = (): RunDraft => ({ step: 'experiments', outcome: 'completed', name: '', purpose: '', dataset: '', split: '', model: '', settings: '', seeds: '', versions: '', hardware: '', duration: '', metrics: [], log: '', notes: '' });

// ---------- Redaction ----------

/** Hides names in home-folder paths, emails, addresses and secrets. Returns what was hidden. */
export function redact(text: string): { text: string; hidden: Sensitive[] } {
  const hidden = findSensitive(text);
  // Network paths, hosts, user names, serials and phones first, so the rules below see what is left.
  const t = redactPii(text)
    .replace(/([A-Za-z]:\\Users\\)[^\\\s]+/gi, '$1[user]')
    .replace(/\/(Users|home)\/[^/\s]+/g, '/$1/[user]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g, (m, off: number, all: string) => (/(version|python|pip|torch|cuda|git|smi)[^\n]{0,24}$/i.test(all.slice(Math.max(0, off - 30), off)) ? m : '[ip]'))
    .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, '[secret]')
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '[secret]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[secret]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*/g, '[secret]')
    .replace(/\b(password|passwd|pwd|token|secret|api[_-]?key)(\s*[:=]\s*)\S+/gi, '$1$2[secret]');
  return { text: t, hidden };
}

// ---------- Validation and cleaning ----------

const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function cleanMetric(v: unknown): Metric | null {
  const m = v as Metric;
  if (!m || typeof m !== 'object' || !finite(m.value)) return null;
  const name = clip(m.name, LIMITS.metricName).trim();
  if (!name) return null;
  const split = (SPLITS as readonly string[]).includes(m.split) ? m.split : 'other';
  const note = clip(m.note, LIMITS.metricNote).trim();
  return { name, value: m.value, split, ...(note ? { note } : {}) };
}

/** Every text field is trimmed to its limit. Logs and notes are redacted, whatever the browser sent. */
export function cleanDraft(d: Partial<RunDraft>): RunDraft {
  const t = (k: keyof typeof LIMITS) => redact(clip((d as Record<string, unknown>)[k], LIMITS[k]).trim()).text;
  return {
    step: d.step === 'research' ? 'research' : 'experiments',
    ...(isStepId(d.stepId) ? { stepId: d.stepId } : {}),
    outcome: d.outcome === 'failed' ? 'failed' : 'completed',
    name: t('name'),
    purpose: t('purpose'),
    dataset: t('dataset'),
    split: t('split'),
    model: t('model'),
    settings: t('settings'),
    seeds: t('seeds'),
    versions: t('versions'),
    hardware: t('hardware'),
    duration: t('duration'),
    metrics: (Array.isArray(d.metrics) ? d.metrics : []).map(cleanMetric).filter((m): m is Metric => !!m).slice(0, MAX_METRICS),
    log: redact(clip(d.log, MAX_LOG)).text,
    notes: t('notes'),
  };
}

/** Problems that stop a run from being saved, in plain words. */
export function runProblems(d: RunDraft, lang: Lang = 'en'): string[] {
  const m = t(lang).problems;
  const p: string[] = [];
  if (!d.name.trim()) p.push(m.name);
  if (d.outcome === 'completed' && !d.metrics.length) p.push(m.noResult);
  if (d.outcome === 'failed' && !d.notes.trim() && !d.log.trim()) p.push(m.failedNoReason);
  const seen = new Set<string>();
  for (const x of d.metrics) {
    const key = `${x.name.toLowerCase()}|${x.split}`;
    if (seen.has(key)) p.push(fill(m.duplicate, { name: x.name, split: lang === 'en' ? x.split : t(lang).splits[x.split].toLowerCase() }));
    seen.add(key);
  }
  return p;
}

/** Reads a stored run. Anything damaged is dropped instead of breaking the page. */
export function cleanRun(v: unknown): RunRecord | null {
  const r = v as RunRecord;
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !/^[A-Za-z0-9-]{6,40}$/.test(r.id) || typeof r.createdAt !== 'string') return null;
  const d = cleanDraft(r);
  if (!d.name) return null;
  return { id: r.id, source: 'student', ...d, createdAt: r.createdAt.slice(0, 40), updatedAt: clip(r.updatedAt, 40) || r.createdAt.slice(0, 40), ...(typeof r.addedToSheet === 'string' ? { addedToSheet: r.addedToSheet.slice(0, 40) } : {}) };
}

/** Hides the student's own name, from the account email, in every text field of a run. Used on the server before AI calls. */
export function withoutIdentity(r: RunRecord, email?: string): RunRecord {
  const words = identityWords(email);
  if (!words.length) return r;
  const fields = ['name', 'purpose', 'dataset', 'split', 'model', 'settings', 'seeds', 'versions', 'hardware', 'duration', 'log', 'notes'] as const;
  const out = { ...r, metrics: r.metrics.map((m) => ({ ...m, name: redactIdentity(m.name, words) })) };
  for (const f of fields) out[f] = redactIdentity(r[f], words);
  return out;
}

export const cleanRuns = (v: unknown): RunRecord[] => (Array.isArray(v) ? v.map(cleanRun).filter((r): r is RunRecord => !!r).slice(0, MAX_RUNS) : []);

export function newRun(d: RunDraft, now = new Date().toISOString(), id = makeId()): RunRecord {
  return { id, source: 'student', ...cleanDraft(d), createdAt: now, updatedAt: now };
}
function makeId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

// ---------- Metrics from a file ----------

/** Accepts a number written with a dot or a comma, or a percentage. Anything else is refused. */
export function parseNumber(raw: string): number | null {
  const s = raw.trim().replace(/^"|"$/g, '');
  const m = s.match(/^([-+]?\d+(?:[.,]\d+)?(?:e[-+]?\d+)?)\s*(%)?$/i);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

const splitOf = (v: unknown): Split => {
  const s = String(v ?? '').toLowerCase().trim();
  if (['test', 'testing'].includes(s)) return 'test';
  if (['val', 'valid', 'validation', 'dev'].includes(s)) return 'validation';
  if (['train', 'training'].includes(s)) return 'train';
  return 'other';
};

/**
 * Reads metrics from a small CSV or JSON file in the browser. Nothing is uploaded.
 * JSON: {"accuracy": 0.91} or [{"name": "accuracy", "value": 0.91, "split": "test"}].
 * CSV: a "metric,value[,split]" table, or one header row of names with one row of values.
 */
export function parseMetricsFile(fileName: string, text: string, lang: Lang = 'en'): { metrics: Metric[]; problems: string[] } {
  const fp = t(lang).fileProblems;
  const problems: string[] = [];
  if (text.length > MAX_METRICS_FILE) return { metrics: [], problems: [fp.tooLarge] };
  const out: Metric[] = [];
  const push = (name: unknown, value: unknown, split?: unknown) => {
    const n = typeof value === 'number' ? (Number.isFinite(value) ? value : null) : typeof value === 'string' ? parseNumber(value) : null;
    const label = typeof name === 'string' ? name.trim().slice(0, LIMITS.metricName) : '';
    if (!label) return;
    if (n === null) return void problems.push(fill(fp.noNumber, { name: label }));
    out.push({ name: label, value: n, split: splitOf(split) });
  };
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.json')) {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return { metrics: [], problems: [fp.badJson] };
    }
    if (Array.isArray(data)) for (const row of data) push((row as Record<string, unknown>)?.name ?? (row as Record<string, unknown>)?.metric, (row as Record<string, unknown>)?.value, (row as Record<string, unknown>)?.split);
    else if (data && typeof data === 'object') {
      for (const [k, v] of Object.entries(data)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k2, v2] of Object.entries(v)) push(k2, v2, k);
        else push(k, v);
      }
    } else problems.push(fp.noJsonMetrics);
  } else if (lower.endsWith('.csv')) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
    // Files saved with a comma as the decimal mark use a semicolon or a tab between columns.
    const sep = lines[0]?.includes('\t') ? '\t' : lines[0]?.includes(';') ? ';' : ',';
    const rows = lines.map((l) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, '')));
    if (!rows.length) return { metrics: [], problems: [fp.emptyCsv] };
    const head = rows[0].map((h) => h.toLowerCase());
    const ni = head.findIndex((h) => ['metric', 'name', 'measure'].includes(h));
    const vi = head.findIndex((h) => ['value', 'score', 'result'].includes(h));
    if (ni >= 0 && vi >= 0) {
      const si = head.findIndex((h) => h === 'split' || h === 'set');
      for (const r of rows.slice(1)) push(r[ni], r[vi], si >= 0 ? r[si] : undefined);
    } else if (rows.length === 2) rows[0].forEach((h, i) => push(h, rows[1][i]));
    else problems.push(fp.csvShape);
  } else return { metrics: [], problems: [fp.notCsvJson] };
  if (out.length > MAX_METRICS) problems.push(fill(fp.onlyFirst, { n: MAX_METRICS }));
  if (!out.length && !problems.length) problems.push(fp.noneFound);
  return { metrics: out.slice(0, MAX_METRICS), problems };
}

// ---------- Summaries ----------

export type MetricSummary = { name: string; split: Split; n: number; mean: number; sd: number | null; min: number; max: number };

/** Mean and sample standard deviation across completed runs, for each metric and split. Only submitted values are used. */
export function summarize(runs: RunRecord[]): MetricSummary[] {
  const groups = new Map<string, { name: string; split: Split; values: number[] }>();
  for (const r of runs) {
    if (r.outcome !== 'completed') continue;
    for (const m of r.metrics) {
      const key = `${m.name.toLowerCase()}|${m.split}`;
      const g = groups.get(key) ?? { name: m.name, split: m.split, values: [] };
      g.values.push(m.value);
      groups.set(key, g);
    }
  }
  return [...groups.values()].map(({ name, split, values }) => {
    const n = values.length;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const sd = n > 1 ? Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : null;
    return { name, split, n, mean, sd, min: Math.min(...values), max: Math.max(...values) };
  });
}

/** Shows a number as the student gave it, or rounded sensibly for a computed mean. */
export const fmt = (n: number, digits = 4) => (Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(digits))));

/** The versions the Lab has verified, so the student does not retype them. The student can still edit them. */
export function versionsFromLab(lab: LabState | undefined, os: string | null): string {
  if (!lab) return '';
  return Object.values(lab.tools)
    .map((t) => t.check)
    .filter((c) => c && c.status === 'verified' && c.found && (!os || c.os === os))
    .map((c) => c!.found!)
    .join('; ');
}

/** A step's title in the chosen language. Unknown IDs have no title. */
export function stepTitle(id: string | undefined, lang: Lang = 'en') {
  const step = STEPS.find((x) => x.id === id);
  if (!step) return '';
  return lang === 'fr' ? STEP_TITLES_FR[step.id] ?? step.title : step.title;
}
export const isStepId = (v: unknown): v is string => typeof v === 'string' && STEPS.some((x) => x.id === v);

/** Plain text for the results sheet. It always says who reported it. */
export function runToText(r: RunRecord, lang: Lang = 'en'): string {
  const m = t(lang).sheet;
  const splits = t(lang).splits;
  const num = (n: number) => (lang === 'fr' ? fmt(n, 12).replace('.', ',') : fmt(n, 12));
  const lines = [
    `${m.run}: ${r.name} (${m.reported}, ${r.createdAt.slice(0, 10)}${r.outcome === 'failed' ? `, ${m.failed}` : ''})`,
    r.stepId && stepTitle(r.stepId, lang) && `${m.step}: ${stepTitle(r.stepId, lang)}`,
    r.purpose && `${m.purpose}: ${r.purpose}`,
    r.dataset && `${m.dataset}: ${r.dataset}`,
    r.split && `${m.split}: ${r.split}`,
    r.model && `${m.model}: ${r.model}`,
    r.settings && `${m.settings}: ${r.settings}`,
    r.seeds && `${m.seeds}: ${r.seeds}`,
    r.versions && `${m.versions}: ${r.versions}`,
    r.hardware && `${m.hardware}: ${r.hardware}`,
    r.duration && `${m.duration}: ${r.duration}`,
    r.metrics.length ? `${m.results}: ${r.metrics.map((x) => `${x.name} (${lang === 'en' ? x.split : splits[x.split].toLowerCase()}) = ${num(x.value)}`).join('; ')}` : '',
    r.notes && `${m.notes}: ${r.notes}`,
  ];
  return lines.filter(Boolean).join('\n');
}

/** A block that runToText wrote, in either language. */
const RUN_BLOCK = /^(Run|Expérience) ?: /;

/**
 * Adds a run block to the results sheet. Existing text is never changed or removed.
 * The standard template is put first when the notes are empty or hold only run blocks,
 * so its headings stay available, and it is never added twice.
 */
export function appendToResultsSheet(work: string, block: string, template: string): string {
  const text = work.trim();
  const tpl = template.trim();
  const firstHeading = tpl.split('\n')[0]?.trim();
  const hasTemplate = !!firstHeading && text.includes(firstHeading);
  const onlyRuns = !!text && text.split(/\n\s*\n/).every((b) => RUN_BLOCK.test(b.trim()));
  if (!text) return tpl ? `${tpl}\n\n${block}` : block;
  if (tpl && !hasTemplate && onlyRuns) return `${tpl}\n\n${text}\n\n${block}`;
  return `${work.trimEnd()}\n\n${block}`;
}

/** The template for the Write tab: added when the notes are empty, or put before notes that hold only run blocks. */
export function withResultsTemplate(work: string, template: string): string | null {
  const text = work.trim();
  const tpl = template.trim();
  if (!tpl) return null;
  if (!text) return template;
  const firstHeading = tpl.split('\n')[0]?.trim();
  const onlyRuns = text.split(/\n\s*\n/).every((b) => RUN_BLOCK.test(b.trim()));
  return !text.includes(firstHeading) && onlyRuns ? `${tpl}\n\n${text}` : null;
}

/** Every number the student submitted in a run, so the AI reply can be checked against it. Dates are not included. */
export function numbersIn(r: RunRecord): Set<number> {
  const set = new Set<number>();
  const text = [r.purpose, r.dataset, r.split, r.model, r.settings, r.seeds, r.versions, r.hardware, r.duration, r.notes, r.log].join('\n');
  for (const m of text.matchAll(/\d+(?:[.,]\d+)?/g)) set.add(Number(m[0].replace(',', '.')));
  for (const m of r.metrics) {
    set.add(m.value);
    set.add(Number((m.value * 100).toPrecision(12)));
    set.add(Number(m.value.toPrecision(12)));
  }
  return set;
}
