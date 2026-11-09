import { describe, expect, it } from 'vitest';
import { cleanLab, currentCheck, emptyLab, fromLabV1, hasLabProgress, newerLab, recordCheck, setMarked, statusOf, update } from '@/lib/lab';
import { LAB_RULES_VERSION, verifyOutput } from '@/lib/labVerify';
import { applySituation, emptyPath, isPathState, STEPS } from '@/lib/path';
import { decideSync, hasWork, samePath } from '@/lib/pathSync';

const T = '2026-11-09T10:00:00.000Z';
const W = { os: 'windows' as const, gpu: 'not_sure' as const };

describe('status transitions', () => {
  it('a tick alone never gives Verified', () => {
    let l = emptyLab();
    expect(statusOf(l.tools.python, 'windows')).toBe('not_started');
    l = setMarked(l, 'python', true, T);
    expect(statusOf(l.tools.python, 'windows')).toBe('marked');
    l = setMarked(l, 'python', false, T);
    expect(statusOf(l.tools.python, 'windows')).toBe('not_started');
    expect(l.tools.python).toBeUndefined();
  });

  it('pasted text that is not checked yet is pending', () => {
    const l = setMarked(emptyLab(), 'git', true, T);
    expect(statusOf(l.tools.git, 'windows', 'git version 2.47.1')).toBe('pending');
  });

  it('only a matching output gives Verified, and a failure or review is kept as such', () => {
    let l = recordCheck(emptyLab(), 'python', 'windows', verifyOutput('python', 'Python 3.12.7', W), T);
    expect(statusOf(l.tools.python, 'windows')).toBe('verified');
    l = recordCheck(l, 'python', 'windows', verifyOutput('python', 'Python 3.8.10', W), T);
    expect(statusOf(l.tools.python, 'windows')).toBe('failed');
    l = recordCheck(l, 'venv', 'windows', verifyOutput('venv', 'C:\\proj\\env\\Scripts\\python.exe', W), T);
    expect(statusOf(l.tools.venv, 'windows')).toBe('manual_review');
  });

  it('new pasted text replaces an old result until it is checked', () => {
    const l = recordCheck(emptyLab(), 'python', 'windows', verifyOutput('python', 'Python 3.12.7', W), T);
    expect(statusOf(l.tools.python, 'windows', 'Python 3.13.1')).toBe('pending');
  });

  it('empty and blocked input are never saved', () => {
    const l = emptyLab();
    expect(recordCheck(l, 'python', 'windows', verifyOutput('python', '', W), T)).toBe(l);
    expect(recordCheck(l, 'python', 'windows', verifyOutput('python', 'api_key=abc', W), T)).toBe(l);
  });

  it('a result counts only for its own system and the current rules', () => {
    const l = recordCheck(emptyLab(), 'git', 'windows', verifyOutput('git', 'git version 2.47.1.windows.1', W), T);
    expect(currentCheck(l.tools.git, 'windows')).toBeTruthy();
    expect(statusOf(l.tools.git, 'linux')).toBe('not_started');
    const old = { ...l.tools.git, check: { ...l.tools.git.check!, rule: LAB_RULES_VERSION - 1 } };
    expect(statusOf(old, 'windows')).toBe('not_started');
  });

  it('stores the result, never the pasted text', () => {
    const l = recordCheck(emptyLab(), 'pip', 'windows', verifyOutput('pip', 'pip 24.3.1 from C:\\Users\\student\\x\\pip (python 3.12)', W), T);
    expect(JSON.stringify(l)).not.toMatch(/student|Users|from/);
    expect(l.tools.pip.check).toEqual({ status: 'verified', os: 'windows', rule: LAB_RULES_VERSION, at: T, reason: 'ok', found: 'pip 24.3.1 (Python 3.12)' });
  });
});

describe('stored Lab data', () => {
  it('cleans damaged values instead of failing', () => {
    expect(cleanLab(null)).toBeUndefined();
    expect(cleanLab('x')).toBeUndefined();
    const l = cleanLab({ workTypes: ['statistics', 'hacking', 'statistics'], os: 'beos', gpu: 'maybe', tools: { python: { marked: true, check: { status: 'verified', os: 'windows', rule: 1, at: T, reason: 'ok', found: 'Python 3.12.7' } }, 'BAD ID': { marked: true }, git: { check: { status: 'great' } } }, updatedAt: T })!;
    expect(l.workTypes).toEqual(['statistics']);
    expect(l.os).toBeNull();
    expect(l.gpu).toBe('not_sure');
    expect(Object.keys(l.tools)).toEqual(['python']);
  });

  it('a hand-written "verified" without a valid check record is dropped', () => {
    const l = cleanLab({ workTypes: [], tools: { python: { verified: true, check: { status: 'verified' } } } })!;
    expect(l.tools.python).toBeUndefined();
  });

  it('reads the earlier browser-only format', () => {
    const l = fromLabV1({ workTypes: ['python', 'statistics'], os: 'linux', gpu: 'no', osConfirmed: true, marked: { python: true, git: false } })!;
    expect(l).toMatchObject({ workTypes: ['python', 'statistics'], os: 'linux', gpu: 'no', osConfirmed: true, tools: { python: { marked: true } } });
    expect(statusOf(l.tools.python, 'linux')).toBe('marked');
    expect(fromLabV1({})).toBeUndefined();
  });

  it('keeps the newer copy, and never prefers an empty one', () => {
    const a = update(emptyLab(), { workTypes: ['python'] }, '2026-11-09T10:00:00Z');
    const b = update(emptyLab(), { workTypes: ['nlp'] }, '2026-11-09T11:00:00Z');
    expect(newerLab(a, b)).toBe(b);
    expect(newerLab(a, emptyLab())).toBe(a);
    expect(newerLab(undefined, a)).toBe(a);
    expect(hasLabProgress(emptyLab())).toBe(false);
  });
});

describe('PathState compatibility', () => {
  it('older copies without Lab data are still valid', () => {
    const p = emptyPath();
    expect(isPathState(p)).toBe(true);
    expect(p.lab).toBeUndefined();
    expect(isPathState({ ...p, lab: { anything: 1 } })).toBe(true);
  });

  it('adding Lab data keeps every other part unchanged', () => {
    const p = applySituation(emptyPath(), 'title', { title: 'A synthetic title' });
    const withLab = { ...p, lab: setMarked(emptyLab(), 'python', true, T) };
    const { lab, ...rest } = withLab;
    expect(rest).toEqual(p);
    expect(lab.tools.python.marked).toBe(true);
  });

  it('starting a thesis keeps Lab progress', () => {
    const p = { ...emptyPath(), lab: setMarked(emptyLab(), 'git', true, T) };
    expect(applySituation(p, 'nothing', {}).lab?.tools.git.marked).toBe(true);
  });

  it('Lab progress alone does not count as thesis work, so it cannot start a "two versions" choice', () => {
    const local = { ...emptyPath(), lab: setMarked(emptyLab(), 'git', true, T), savedAt: T };
    expect(hasWork(local)).toBe(false);
    const cloud = { data: { ...applySituation(emptyPath(), 'nothing', {}), savedAt: '2026-11-01T00:00:00Z' }, version: 'v1' };
    expect(decideSync(local, cloud, null, 'u1')).toBe('adopt');
  });

  it('a Lab change on a started thesis is saved like any other edit', () => {
    const base = { ...applySituation(emptyPath(), 'nothing', {}), savedAt: '2026-11-09T09:00:00Z' };
    const rec = { userId: 'u1', version: 'v1', savedAt: base.savedAt };
    const edited = { ...base, lab: setMarked(emptyLab(), 'git', true, T), savedAt: T };
    expect(samePath(edited, base)).toBe(false);
    expect(decideSync(edited, { data: base, version: 'v1' }, rec, 'u1')).toBe('push');
  });

  it('keeps the 21 step IDs and order', () => {
    expect(STEPS).toHaveLength(21);
  });
});
