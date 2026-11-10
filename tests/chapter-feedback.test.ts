import { describe, expect, it } from 'vitest';
import { addReport, buildReport, compareReports, exportReports, FEEDBACK_STEP, fingerprintOf, latestOf, removeReport, reportsOf, type ChapterReport } from '@/lib/chapterFeedback';
import type { Feedback } from '@/lib/feedback';
import { FEEDBACK_LIMIT } from '@/lib/limits';
import { emptyPath, isPathState, STEPS, type PathState } from '@/lib/path';
import { decideSync, samePath } from '@/lib/pathSync';

// Phase P3: chapter feedback history. All text is synthetic.
const fb = (summary: string, problems: string[] = ['The method is not justified against alternatives']): Feedback => ({
  summary,
  strengths: ['Clear aim'],
  issues: problems.map((p, i) => ({ severity: (['major', 'moderate', 'minor'] as const)[i % 3], location: '3.1', problem: p, why_it_matters: 'Examiners ask.', guiding_question: 'Why this method?' })),
  next_steps: ['Compare with two recent methods'],
});
const started = (over: Partial<PathState> = {}): PathState => ({ ...emptyPath(), started: true, title: 'Fictional lantern thesis', ...over });
const settings = { degree: 'master_academic', discipline: 'Computer science', language: 'English' };
const v1 = 'Chapter 3 studies the fictional lantern method.\nWe use dataset A.\nResults follow.';
const v2 = 'Chapter 3 studies the fictional lantern method.\nWe use dataset A and dataset B, chosen because B is public.\nResults follow.\nLimits are stated.';
const report = (text: string, f: Feedback, at: string, chapter = 'Chapter 3 Method') => buildReport({ chapter, text, feedback: f, settings }, at, `id-${at}`);
const add = (p: PathState, r: ChapterReport) => {
  const x = addReport(p, r);
  if (x.status !== 'added') throw new Error(x.status);
  return x.path;
};

describe('saving reports', () => {
  it('keeps every field a report needs, on an existing step', () => {
    const r = report(v1, fb('First.'), '2026-11-10T08:00:00.000Z');
    expect(r).toMatchObject({ id: 'id-2026-11-10T08:00:00.000Z', stepId: 'draft', chapter: 'Chapter 3 Method', analyzedAt: '2026-11-10T08:00:00.000Z', status: 'current', feedback: fb('First.') });
    expect(r.snapshot).toMatchObject({ text: v1, totalChars: v1.length, version: fingerprintOf(v1) });
    expect(STEPS.map((s) => s.id)).toContain(FEEDBACK_STEP);
    expect(STEPS).toHaveLength(21);
  });
  it('the snapshot is the part the AI read, and its version identifies the whole text', () => {
    const long = 'Lantern sentence. '.repeat(3000);
    const r = report(long, fb('Long.'), '2026-11-10T08:00:00.000Z');
    expect(r.snapshot.text).toHaveLength(FEEDBACK_LIMIT);
    expect(r.snapshot.totalChars).toBe(long.length);
    expect(r.snapshot.version).not.toBe(fingerprintOf(long.slice(0, FEEDBACK_LIMIT)));
  });
  it('a second analysis is added: the first keeps all its content and is only marked superseded', () => {
    const first = report(v1, fb('First.'), '2026-11-10T08:00:00.000Z');
    const second = report(v2, fb('Second.'), '2026-11-10T09:00:00.000Z');
    const p = add(add(started(), first), second);
    expect(p.chapterFeedback).toHaveLength(2);
    expect(p.chapterFeedback![0]).toEqual({ ...first, status: 'superseded' });
    expect(p.chapterFeedback![1]).toEqual(second);
    expect(latestOf(reportsOf(p), 'chapter 3  method')?.id).toBe(second.id);
  });
  it('another chapter keeps its own current report', () => {
    const p = add(add(started(), report(v1, fb('One.'), '2026-11-10T08:00:00.000Z', 'Chapter 2 Literature')), report(v2, fb('Two.'), '2026-11-10T09:00:00.000Z'));
    expect(reportsOf(p).map((r) => r.status)).toEqual(['current', 'current']);
  });
  it('the same response retried is not stored twice', () => {
    const p = add(started(), report(v1, fb('First.'), '2026-11-10T08:00:00.000Z'));
    const again = addReport(p, report(v1, fb('First.'), '2026-11-10T08:00:05.000Z'));
    expect(again.status).toBe('duplicate');
    expect(again.path).toBe(p);
    // A different answer on the same text is a real new analysis.
    expect(addReport(p, report(v1, fb('Different.'), '2026-11-10T08:01:00.000Z')).status).toBe('added');
  });
  it('when storage would be full, nothing changes and the result says so', () => {
    const p = add(started(), report(v1, fb('First.'), '2026-11-10T08:00:00.000Z'));
    const r = addReport(p, report(v2, fb('Second.'), '2026-11-10T09:00:00.000Z'), 500);
    expect(r.status).toBe('full');
    expect(r.path).toBe(p);
    expect(p.chapterFeedback).toHaveLength(1);
  });
  it('thesis content, steps and other data are untouched', () => {
    const base = started({ parts: { intro: 'My own text.' }, steps: { draft: { work: 'Notes', checks: [0], status: 'open' } }, runs: [] });
    const p = add(base, report(v1, fb('First.'), '2026-11-10T08:00:00.000Z'));
    const { chapterFeedback: _c, ...rest } = p;
    expect(rest).toEqual(base);
  });
});

describe('older and unusual saved copies', () => {
  it('a copy saved before P3 has an empty history and stays valid', () => {
    const old = JSON.parse(JSON.stringify(started())) as PathState;
    expect(isPathState(old)).toBe(true);
    expect(reportsOf(old)).toEqual([]);
    expect(add(old, report(v1, fb('First.'), '2026-11-10T08:00:00.000Z')).chapterFeedback).toHaveLength(1);
  });
  it('an unreadable entry is not shown, and is kept when a report is added or removed', () => {
    const odd = { id: 'odd', note: 'not a report' } as unknown as ChapterReport;
    const p = add(started({ chapterFeedback: [odd] }), report(v1, fb('First.'), '2026-11-10T08:00:00.000Z'));
    expect(reportsOf(p)).toHaveLength(1);
    expect(p.chapterFeedback![0]).toBe(odd);
    expect(removeReport(p, 'id-2026-11-10T08:00:00.000Z').chapterFeedback).toEqual([odd]);
  });
});

describe('removing, only when the student asks', () => {
  it('removing the latest makes the newest remaining report current', () => {
    const p = add(add(started(), report(v1, fb('First.'), '2026-11-10T08:00:00.000Z')), report(v2, fb('Second.'), '2026-11-10T09:00:00.000Z'));
    const q = removeReport(p, 'id-2026-11-10T09:00:00.000Z');
    expect(reportsOf(q).map((r) => [r.id, r.status])).toEqual([['id-2026-11-10T08:00:00.000Z', 'current']]);
    expect(removeReport(q, 'unknown')).toBe(q);
  });
  it('the export holds every report', () => {
    const p = add(started(), report(v1, fb('First.'), '2026-11-10T08:00:00.000Z'));
    expect(JSON.parse(exportReports(reportsOf(p), '2026-11-10T10:00:00.000Z')).reports).toHaveLength(1);
  });
});

describe('comparing two reports', () => {
  it('shows what changed in the chapter and in the points raised, oldest first', () => {
    const first = report(v1, fb('First.', ['The method is not justified against alternatives', 'No limits section']), '2026-11-10T08:00:00.000Z');
    const second = report(v2, fb('Second.', ['The method is not justified against recent alternatives', 'Figures disagree with table 2']), '2026-11-10T09:00:00.000Z');
    const c = compareReports(second, first);
    expect([c.earlier.id, c.later.id]).toEqual([first.id, second.id]);
    expect(c.sameVersion).toBe(false);
    expect(c.text.kept).toBe(2);
    expect(c.text.added).toEqual(['We use dataset A and dataset B, chosen because B is public.', 'Limits are stated.']);
    expect(c.text.removed).toEqual(['We use dataset A.']);
    expect(c.issues.onlyEarlier.map((i) => i.problem)).toEqual(['No limits section']);
    expect(c.issues.onlyLater.map((i) => i.problem)).toEqual(['Figures disagree with table 2']);
    expect(c.issues.both).toHaveLength(1);
  });
  it('recognises the same chapter version', () => {
    expect(compareReports(report(v1, fb('A.'), '2026-11-10T08:00:00.000Z'), report(v1, fb('B.'), '2026-11-10T09:00:00.000Z')).sameVersion).toBe(true);
  });
});

describe('sync keeps the history', () => {
  it('a new report is a change to push, never a copy to replace silently', () => {
    const before = started({ savedAt: '2026-11-10T07:00:00.000Z' });
    const after = { ...add(before, report(v1, fb('First.'), '2026-11-10T08:00:00.000Z')), savedAt: '2026-11-10T08:00:00.000Z' };
    expect(samePath(before, after)).toBe(false);
    const rec = { userId: 'u1', version: 'v1', savedAt: before.savedAt! };
    expect(decideSync(after, { data: before, version: 'v1' }, rec, 'u1')).toBe('push');
    // Both sides changed: the student chooses, and the other copy is set aside rather than erased.
    expect(decideSync(after, { data: { ...before, savedAt: '2026-11-10T07:30:00.000Z' }, version: 'v2' }, rec, 'u1')).toBe('conflict');
  });
});
