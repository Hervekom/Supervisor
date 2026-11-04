import { afterEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { clearAi, loadAi, saveAi } from '@/lib/aiSettings';
import { emptyPath, isPathState, newerPath, nextOpen, progress, SITUATIONS, stepState, STEPS, type PathState } from '@/lib/path';
import { validateProfile } from '@/lib/profiles';
import type { Profile } from '@/lib/types';

const STEP_IDS = ['title', 'topic', 'literature', 'proposal', 'method', 'alignment', 'research', 'experiments', 'evidence', 'mid_term', 'paper', 'outline', 'draft', 'revise', 'references', 'pre_defense', 'submission', 'blind_review', 're_review', 'defense', 'archive'];

const nuist = JSON.parse(fs.readFileSync('data/profiles/cn-nuist-international-postgraduate-2026.json', 'utf8')) as Profile;
const sha = (v: unknown) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');

function fakeStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}

afterEach(() => vi.unstubAllGlobals());

describe('thesis steps', () => {
  it('keeps every step ID in order', () => {
    expect(STEPS.map((s) => s.id)).toEqual(STEP_IDS);
    expect(STEPS.length).toBe(21);
  });
  it('keeps the eight starting points', () => {
    expect(SITUATIONS.map((s) => [s.id, s.start])).toEqual([
      ['nothing', 'topic'], ['title', 'title'], ['proposal', 'proposal'], ['research', 'research'],
      ['draft', 'draft'], ['full', 'revise'], ['reviewers', 're_review'], ['defense', 'defense'],
    ]);
  });
  it('keeps task order within each step', () => {
    expect(Object.fromEntries(STEPS.map((s) => [s.id, s.tasks.length]))).toMatchSnapshot();
  });
});

describe('PathState', () => {
  it('keeps the shape of a new path', () => {
    expect(emptyPath()).toEqual({ topic: '', discipline: '', defenseDate: '', current: 'title', steps: {}, log: [] });
  });
  // A saved document as written by the current release. It must always load.
  const saved: PathState = {
    topic: 'Fictional topic',
    discipline: 'Computer science',
    defenseDate: '2027-06-15',
    current: 'literature',
    started: true,
    situation: 'title',
    title: 'Fictional title',
    savedAt: '2026-11-04T10:00:00.000Z',
    steps: {
      title: {
        work: 'Fictional work',
        checks: [0, 1, 2, 3, 4],
        status: 'done',
        rounds: 2,
        updated: '2026-11-04T10:00:00.000Z',
        guide: { intro: 'Why', tasks: ['Task'] },
        coach: { verdict: 'almost', summary: 's', criteria: [{ standard: 'x', status: 'partly', comment: 'c' }], weakest: 'w', questions: ['q'], next_action: 'n' },
      },
      topic: { work: '', checks: [], status: 'skipped' },
    },
    log: [{ at: '2026-11-04T10:00:00.000Z', step: 'title', tool: 'AI reviewer critique' }],
  };
  it('loads a saved path through JSON', () => {
    const restored = JSON.parse(JSON.stringify(saved));
    expect(isPathState(restored)).toBe(true);
    expect(stepState(restored, 'title').status).toBe('done');
    expect(progress(restored).closed).toBe(2);
    expect(nextOpen(restored, 'title')?.id).toBe('literature');
  });
  it('rejects damaged saved data', () => {
    expect(isPathState({ ...saved, current: 'removed_step' })).toBe(false);
    expect(isPathState({ ...saved, log: null })).toBe(false);
    expect(isPathState(null)).toBe(false);
  });
  it('prefers the newest copy', () => {
    expect(newerPath(saved, { ...saved, savedAt: '2026-11-05T10:00:00.000Z' })?.savedAt).toContain('11-05');
  });
});

describe('localStorage keys', () => {
  it('keeps path:v1 in the app source', () => {
    expect(fs.readFileSync('src/app/page.tsx', 'utf8')).toContain("const KEY = 'path:v1';");
    expect(fs.readFileSync('src/lib/pathSync.ts', 'utf8')).toContain("export const PATH_KEY = 'path:v1';");
  });
  it('keeps the ai:v1 key and its format', () => {
    const store = fakeStorage();
    vi.stubGlobal('localStorage', store);
    saveAi({ provider: 'kimi', apiKey: 'fake-key-123456', model: 'fake-model' });
    expect(JSON.parse(store.m.get('ai:v1')!)).toEqual({ provider: 'kimi', apiKey: 'fake-key-123456', model: 'fake-model' });
    expect(loadAi()?.provider).toBe('kimi');
    clearAi();
    expect(store.m.has('ai:v1')).toBe(false);
  });
  it('reads a stored custom provider', () => {
    const store = fakeStorage();
    store.setItem('ai:v1', JSON.stringify({ provider: 'custom', baseUrl: 'https://api.example.com/v1', apiKey: 'fake-key-123456', model: 'm' }));
    vi.stubGlobal('localStorage', store);
    expect(loadAi()?.baseUrl).toBe('https://api.example.com/v1');
  });
  it('ignores incomplete stored AI settings', () => {
    const store = fakeStorage();
    store.setItem('ai:v1', JSON.stringify({ provider: 'kimi' }));
    vi.stubGlobal('localStorage', store);
    expect(loadAi()).toBeNull();
  });
});

describe('NUIST profile', () => {
  it('stays valid and keeps its counts', async () => {
    expect((await validateProfile(nuist)).ok).toBe(true);
    expect([nuist.rules.length, nuist.conflicts.length, nuist.workflow.length, nuist.sources.length]).toEqual([60, 10, 9, 9]);
    expect(nuist.profile_id).toBe('cn-nuist-international-postgraduate-2026');
    expect(nuist.status).toBe('extracted');
  });
  it('keeps every rule, conflict and stage', () => {
    expect({
      rules: nuist.rules.map((r) => `${r.id}|${r.key}`),
      conflicts: nuist.conflicts.map((c) => `${c.id}|${c.status}`),
      workflow: nuist.workflow.map((w) => w.id),
    }).toMatchSnapshot();
  });
  it('keeps rule values and sources unchanged', () => {
    expect(sha(nuist.rules.map((r) => [r.id, r.value, r.applies_to, r.severity, r.source]))).toMatchSnapshot();
  });
});
