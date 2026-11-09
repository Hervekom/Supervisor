// Experiment run records that the student reports by hand. Stored inside PathState, so no database change.
// Supervisor never runs anything and never invents a number: every value here was typed or imported by the student.

import { findSensitive, type Sensitive } from './labVerify';
import type { LabState } from './lab';

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
  let t = text
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
export function runProblems(d: RunDraft): string[] {
  const p: string[] = [];
  if (!d.name.trim()) p.push('Give the run a name, for example "Baseline, seed 1".');
  if (d.outcome === 'completed' && !d.metrics.length) p.push('Add at least one result, or mark the run as failed.');
  if (d.outcome === 'failed' && !d.notes.trim() && !d.log.trim()) p.push('Say what went wrong in the notes or the log, so the failed run is still useful.');
  const seen = new Set<string>();
  for (const m of d.metrics) {
    const key = `${m.name.toLowerCase()}|${m.split}`;
    if (seen.has(key)) p.push(`"${m.name}" on ${m.split} appears twice.`);
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
export function parseMetricsFile(fileName: string, text: string): { metrics: Metric[]; problems: string[] } {
  const problems: string[] = [];
  if (text.length > MAX_METRICS_FILE) return { metrics: [], problems: ['This file is larger than 50 KB. Keep only the final metrics in it.'] };
  const out: Metric[] = [];
  const push = (name: unknown, value: unknown, split?: unknown) => {
    const n = typeof value === 'number' ? (Number.isFinite(value) ? value : null) : typeof value === 'string' ? parseNumber(value) : null;
    const label = typeof name === 'string' ? name.trim().slice(0, LIMITS.metricName) : '';
    if (!label) return;
    if (n === null) return void problems.push(`"${label}" has no number and was skipped.`);
    out.push({ name: label, value: n, split: splitOf(split) });
  };
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.json')) {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return { metrics: [], problems: ['This JSON file could not be read.'] };
    }
    if (Array.isArray(data)) for (const row of data) push((row as Record<string, unknown>)?.name ?? (row as Record<string, unknown>)?.metric, (row as Record<string, unknown>)?.value, (row as Record<string, unknown>)?.split);
    else if (data && typeof data === 'object') {
      for (const [k, v] of Object.entries(data)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k2, v2] of Object.entries(v)) push(k2, v2, k);
        else push(k, v);
      }
    } else problems.push('This JSON file has no metrics.');
  } else if (lower.endsWith('.csv')) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
    // Files saved with a comma as the decimal mark use a semicolon or a tab between columns.
    const sep = lines[0]?.includes('\t') ? '\t' : lines[0]?.includes(';') ? ';' : ',';
    const rows = lines.map((l) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, '')));
    if (!rows.length) return { metrics: [], problems: ['This CSV file is empty.'] };
    const head = rows[0].map((h) => h.toLowerCase());
    const ni = head.findIndex((h) => ['metric', 'name', 'measure'].includes(h));
    const vi = head.findIndex((h) => ['value', 'score', 'result'].includes(h));
    if (ni >= 0 && vi >= 0) {
      const si = head.findIndex((h) => h === 'split' || h === 'set');
      for (const r of rows.slice(1)) push(r[ni], r[vi], si >= 0 ? r[si] : undefined);
    } else if (rows.length === 2) rows[0].forEach((h, i) => push(h, rows[1][i]));
    else problems.push('Use a "metric,value" table, or one row of names and one row of values.');
  } else return { metrics: [], problems: ['Choose a .csv or .json file.'] };
  if (out.length > MAX_METRICS) problems.push(`Only the first ${MAX_METRICS} metrics were kept.`);
  if (!out.length && !problems.length) problems.push('No metrics were found in this file.');
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

/** Plain text for the results sheet. It always says who reported it. */
export function runToText(r: RunRecord): string {
  const lines = [
    `Run: ${r.name} (${SOURCE_LABEL.toLowerCase()}, ${r.createdAt.slice(0, 10)}${r.outcome === 'failed' ? ', failed' : ''})`,
    r.purpose && `Purpose: ${r.purpose}`,
    r.dataset && `Data: ${r.dataset}`,
    r.split && `Split: ${r.split}`,
    r.model && `Method or model: ${r.model}`,
    r.settings && `Settings: ${r.settings}`,
    r.seeds && `Seeds: ${r.seeds}`,
    r.versions && `Software: ${r.versions}`,
    r.hardware && `Hardware: ${r.hardware}`,
    r.duration && `Time: ${r.duration}`,
    r.metrics.length ? `Results: ${r.metrics.map((m) => `${m.name} (${m.split}) = ${fmt(m.value, 12)}`).join('; ')}` : '',
    r.notes && `Notes: ${r.notes}`,
  ];
  return lines.filter(Boolean).join('\n');
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
