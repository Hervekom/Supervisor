// Lab progress: what the student chose, what they marked, and the results of output checks.
// Stored as an optional field of PathState, so it syncs with the thesis without any database change.

import { t, type Lang } from './i18n';
import { LAB_RULES_VERSION, type CheckResult, type CheckStatus } from './labVerify';
import type { GpuAnswer, Os, WorkType } from './software';

export type LabCheck = {
  status: CheckStatus;
  /** System the output came from. A result for another system does not count. */
  os: Os;
  /** Rule version used. A result from an older rule does not count. */
  rule: number;
  at: string;
  found?: string;
  reason: string;
};
export type LabTool = { marked?: boolean; check?: LabCheck };
export type LabState = {
  workTypes: (WorkType | 'python')[];
  os: Os | null;
  gpu: GpuAnswer;
  osConfirmed: boolean;
  tools: Record<string, LabTool>;
  updatedAt: string;
};

/** The six statuses a student can see. A checkbox alone can never reach "verified". */
export type LabStatus = 'not_started' | 'marked' | 'pending' | 'verified' | 'failed' | 'manual_review';
export const STATUS_LABEL: Record<LabStatus, string> = t('en').status;
export const statusLabel = (s: LabStatus, lang: Lang = 'en') => t(lang).status[s];

export const emptyLab = (): LabState => ({ workTypes: [], os: null, gpu: 'not_sure', osConfirmed: false, tools: {}, updatedAt: '' });

const WORK = ['python', 'statistics', 'data_science', 'machine_learning', 'deep_learning', 'computer_vision', 'nlp'];
const OSES = ['windows', 'macos', 'linux'];
const GPUS = ['yes', 'no', 'not_sure'];
const STATUSES = ['verified', 'failed', 'manual_review'];
const ID = /^[a-z0-9-]{1,40}$/;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined);

function cleanCheck(v: unknown): LabCheck | undefined {
  const c = v as LabCheck;
  if (!c || typeof c !== 'object' || !STATUSES.includes(c.status) || !OSES.includes(c.os) || typeof c.rule !== 'number' || typeof c.at !== 'string') return undefined;
  return { status: c.status, os: c.os, rule: c.rule, at: c.at.slice(0, 40), reason: str(c.reason, 60) ?? '', ...(str(c.found, 120) ? { found: str(c.found, 120) } : {}) };
}

/** Accepts only the known shape, so a damaged or hand-edited value cannot break the page. */
export function cleanLab(v: unknown): LabState | undefined {
  const l = v as LabState;
  if (!l || typeof l !== 'object' || Array.isArray(l)) return undefined;
  const tools: Record<string, LabTool> = {};
  if (l.tools && typeof l.tools === 'object') {
    for (const [id, t] of Object.entries(l.tools).slice(0, 60)) {
      if (!ID.test(id) || !t || typeof t !== 'object') continue;
      const check = cleanCheck((t as LabTool).check);
      const marked = (t as LabTool).marked === true;
      if (marked || check) tools[id] = { ...(marked ? { marked } : {}), ...(check ? { check } : {}) };
    }
  }
  return {
    workTypes: Array.isArray(l.workTypes) ? [...new Set(l.workTypes.filter((w) => WORK.includes(w)))] : [],
    os: OSES.includes(l.os as string) ? l.os : null,
    gpu: GPUS.includes(l.gpu) ? l.gpu : 'not_sure',
    osConfirmed: l.osConfirmed === true,
    tools,
    updatedAt: str(l.updatedAt, 40) ?? '',
  };
}

/** Reads the browser-only format used before account sync (`lab:v1`). */
export function fromLabV1(v: unknown): LabState | undefined {
  const o = v as { workTypes?: unknown; os?: unknown; gpu?: unknown; osConfirmed?: unknown; marked?: Record<string, unknown> };
  if (!o || typeof o !== 'object' || !Array.isArray(o.workTypes)) return undefined;
  const tools: Record<string, LabTool> = {};
  for (const [id, m] of Object.entries(o.marked ?? {})) if (m === true) tools[id] = { marked: true };
  return cleanLab({ workTypes: o.workTypes, os: o.os, gpu: o.gpu, osConfirmed: o.osConfirmed, tools, updatedAt: '' });
}

export const hasLabProgress = (l: LabState | undefined) => !!l && (l.workTypes.length > 0 || Object.keys(l.tools).length > 0);

/** The newest copy wins. A copy with progress wins over an empty one. */
export function newerLab(a: LabState | undefined, b: LabState | undefined): LabState | undefined {
  if (!hasLabProgress(a)) return hasLabProgress(b) ? b : a ?? b;
  if (!hasLabProgress(b)) return a;
  return (a!.updatedAt ?? '') >= (b!.updatedAt ?? '') ? a : b;
}

/** A stored result counts only for the same system and the current rules. */
export function currentCheck(tool: LabTool | undefined, os: Os | null): LabCheck | undefined {
  const c = tool?.check;
  return c && os && c.os === os && c.rule === LAB_RULES_VERSION ? c : undefined;
}

export function statusOf(tool: LabTool | undefined, os: Os | null, draft = ''): LabStatus {
  // New output waiting to be checked replaces the previous result until it is checked.
  if (draft.trim()) return 'pending';
  const c = currentCheck(tool, os);
  if (c) return c.status;
  return tool?.marked ? 'marked' : 'not_started';
}

const touch = (l: LabState, now: string): LabState => ({ ...l, updatedAt: now });

export function setMarked(l: LabState, id: string, marked: boolean, now = new Date().toISOString()): LabState {
  const t = { ...l.tools[id] };
  if (marked) t.marked = true;
  else delete t.marked;
  const tools = { ...l.tools };
  if (t.marked || t.check) tools[id] = t;
  else delete tools[id];
  return touch({ ...l, tools }, now);
}

/** Saves a result. Empty or blocked input is never saved, and the pasted text is never part of it. */
export function recordCheck(l: LabState, id: string, os: Os, r: CheckResult, now = new Date().toISOString()): LabState {
  if (r.status === 'empty' || r.status === 'blocked') return l;
  const check: LabCheck = { status: r.status, os, rule: LAB_RULES_VERSION, at: now, reason: r.reason, ...(r.found ? { found: r.found } : {}) };
  return touch({ ...l, tools: { ...l.tools, [id]: { ...l.tools[id], check } } }, now);
}

export function update(l: LabState, patch: Partial<Omit<LabState, 'tools' | 'updatedAt'>>, now = new Date().toISOString()): LabState {
  return touch({ ...l, ...patch }, now);
}
