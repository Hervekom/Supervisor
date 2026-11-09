import { beforeEach, describe, expect, it } from 'vitest';
import { emptyLab, recordCheck, setMarked } from '@/lib/lab';
import { verifyOutput } from '@/lib/labVerify';
import { applySituation, emptyPath, STEPS, type PathState } from '@/lib/path';
import { clearLocalCopy, labAtRisk, LAB_MIRROR_KEY, mergeLabMirror, MAX_SET_ASIDE, PATH_KEY, readLabMirror, readLocalPath, readSetAside, removeSetAside, REPLACED_KEY, setAside, setAsideFor, SetAsideFullError } from '@/lib/pathSync';
import { writeLabFor } from '@/lib/labOwner';
import { planRunMerge } from '@/lib/runMerge';
import { appendToResultsSheet, emptyDraft, newRun, runToText, withResultsTemplate } from '@/lib/runs';

// A small in-memory browser storage. All data is synthetic.
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
beforeEach(() => store.clear());

const T = '2026-11-09T10:00:00.000Z';
const W = { os: 'windows' as const, gpu: 'no' as const };
const verifiedLab = (at = T) => recordCheck({ ...emptyLab(), workTypes: ['python'], os: 'windows' }, 'python', 'windows', verifyOutput('python', 'Python 3.12.7', W), at);
const thesis = (over: Partial<PathState> = {}): PathState => ({ ...applySituation(emptyPath(), 'nothing', {}), savedAt: T, ...over });
const run = (id: string, name: string, over = {}) => ({ ...newRun({ ...emptyDraft(), name, metrics: [{ name: 'accuracy', value: 0.9, split: 'test' }] }, T, id), ...over });

describe('Lab progress at sign-out (D4)', () => {
  it('is at risk when it exists but no thesis has been started', () => {
    expect(labAtRisk({ ...emptyPath(), lab: verifiedLab() }, undefined)).toEqual({ verified: 1, checked: 1, marked: 0 });
    expect(labAtRisk(null, setMarked(verifiedLab(), 'git', true, T))).toEqual({ verified: 1, checked: 1, marked: 1 });
  });
  it('is not at risk when there is none, or when it travels with a started thesis', () => {
    expect(labAtRisk(emptyPath(), undefined)).toBeNull();
    expect(labAtRisk(thesis({ lab: verifiedLab() }), verifiedLab())).toBeNull();
  });
  it('newer Lab progress of the same owner joins a started thesis, so the normal save sends it', () => {
    store.set(PATH_KEY, JSON.stringify(thesis()));
    writeLabFor('user:u1', verifiedLab('2026-11-09T11:00:00.000Z'));
    expect(mergeLabMirror('user:u1', '2026-11-09T12:00:00.000Z')).toBe(true);
    const p = readLocalPath()!;
    expect(p.lab?.tools.python.check?.status).toBe('verified');
    expect(p.savedAt).toBe('2026-11-09T12:00:00.000Z');
    expect(p.steps).toEqual(thesis().steps);
    expect(mergeLabMirror('user:u1')).toBe(false);
  });
  it('never joins progress of another owner, or progress without an owner (B2.3.2 D-M1)', () => {
    store.set(PATH_KEY, JSON.stringify(thesis()));
    writeLabFor('user:u1', verifiedLab());
    store.set(LAB_MIRROR_KEY, JSON.stringify(verifiedLab()));
    expect(mergeLabMirror('user:u2')).toBe(false);
    expect(readLocalPath()!.lab).toBeUndefined();
    expect(store.get(LAB_MIRROR_KEY)).toBeDefined();
  });
  it('does nothing without a started thesis, so no false conflict can start', () => {
    store.set(PATH_KEY, JSON.stringify(emptyPath()));
    writeLabFor('user:u1', verifiedLab());
    expect(mergeLabMirror('user:u1')).toBe(false);
  });
  it('sign-out can keep the Lab progress of its owner when the student chooses to', () => {
    store.set(PATH_KEY, JSON.stringify({ ...emptyPath(), lab: verifiedLab() }));
    writeLabFor('user:u1', verifiedLab());
    writeLabFor('user:u2', verifiedLab());
    clearLocalCopy({ keepLab: true, labOwner: 'user:u1', userId: 'u1' });
    expect(store.has(PATH_KEY)).toBe(false);
    expect(readLabMirror('user:u1')?.tools.python.check?.found).toBe('Python 3.12.7');
    clearLocalCopy({ labOwner: 'user:u1', userId: 'u1' });
    expect(readLabMirror('user:u1')).toBeUndefined();
    // Another account's progress is never touched.
    expect(readLabMirror('user:u2')?.tools.python.check?.found).toBe('Python 3.12.7');
  });
  it('sign-out never removes Lab progress without an owner', () => {
    store.set(LAB_MIRROR_KEY, JSON.stringify(verifiedLab()));
    store.set('lab:v1', JSON.stringify({ workTypes: ['python'], marked: { python: true } }));
    clearLocalCopy({ labOwner: 'user:u1', userId: 'u1' });
    expect(store.has(LAB_MIRROR_KEY)).toBe(true);
    expect(store.has('lab:v1')).toBe(true);
  });
});

describe('set-aside copies (D11)', () => {
  it('keeps earlier copies instead of overwriting them, and refuses a sixth instead of dropping one (B2.3.2 D-H1)', () => {
    for (let i = 0; i < MAX_SET_ASIDE; i++) setAside(thesis({ topic: `Version ${i}` }), `2026-11-09T10:0${i}:00.000Z`, 'u1');
    expect(() => setAside(thesis({ topic: 'Version 5' }), '2026-11-09T10:05:00.000Z', 'u1')).toThrow(SetAsideFullError);
    const list = readSetAside();
    expect(list).toHaveLength(MAX_SET_ASIDE);
    expect(list.map((x) => x.path.topic).sort()).toEqual(['Version 0', 'Version 1', 'Version 2', 'Version 3', 'Version 4']);
    expect(JSON.parse(store.get(REPLACED_KEY)!).topic).toBe('Version 4');
    // After an explicit removal there is room again.
    removeSetAside(list.find((x) => x.path.topic === 'Version 0')!);
    setAside(thesis({ topic: 'Version 5' }), '2026-11-09T10:05:00.000Z', 'u1');
    expect(readSetAside()).toHaveLength(MAX_SET_ASIDE);
  });
  it('counts the limit per account, and each account sees only its own copies plus unowned ones', () => {
    for (let i = 0; i < MAX_SET_ASIDE; i++) setAside(thesis({ topic: `A${i}` }), `2026-11-09T10:0${i}:00.000Z`, 'u1');
    setAside(thesis({ topic: 'B0' }), T, 'u2');
    expect(setAsideFor('u2').map((x) => x.path.topic)).toEqual(['B0']);
    expect(setAsideFor('u1')).toHaveLength(MAX_SET_ASIDE);
  });
  it('sign-out keeps or removes only the copies of that account', () => {
    setAside(thesis({ topic: 'A0' }), T, 'u1');
    setAside(thesis({ topic: 'B0' }), '2026-11-09T10:01:00.000Z', 'u2');
    clearLocalCopy({ keepSetAside: true, userId: 'u1' });
    expect(readSetAside()).toHaveLength(2);
    clearLocalCopy({ userId: 'u1' });
    expect(readSetAside().map((x) => x.path.topic)).toEqual(['B0']);
  });
  it('keeps a copy set aside by an older version of the app', () => {
    store.set(REPLACED_KEY, JSON.stringify(thesis({ topic: 'Old single copy' })));
    setAside(thesis({ topic: 'New copy' }));
    expect(readSetAside().map((x) => x.path.topic)).toEqual(['New copy', 'Old single copy']);
  });
});

describe('results sheet (D10)', () => {
  const template = STEPS.find((s) => s.id === 'evidence')!.workTemplate!;
  const block = runToText(run('run-aaaaaa', 'Baseline'));
  it('puts the template first when the notes are empty', () => {
    expect(appendToResultsSheet('', block, template)).toBe(`${template.trim()}\n\n${block}`);
  });
  it('repairs notes that hold only run blocks, without duplicating anything', () => {
    const once = appendToResultsSheet(block, block, template);
    expect(once.startsWith(template.trim())).toBe(true);
    expect(once.split('Research questions:').length).toBe(2);
    const twice = appendToResultsSheet(once, block, template);
    expect(twice.split('Research questions:').length).toBe(2);
    expect(twice.split('Run: Baseline').length).toBe(4);
  });
  it('never changes the student’s own notes', () => {
    expect(appendToResultsSheet('My own notes', block, template)).toBe(`My own notes\n\n${block}`);
    expect(appendToResultsSheet(`${template}\nMain results: good`, block, template)).toBe(`${template}\nMain results: good\n\n${block}`);
  });
  it('the Write tab adds the template only where it is missing', () => {
    expect(withResultsTemplate('', template)).toBe(template);
    expect(withResultsTemplate(block, template)).toBe(`${template.trim()}\n\n${block}`);
    expect(withResultsTemplate('My own notes', template)).toBeNull();
    expect(withResultsTemplate(`${template.trim()}\n\n${block}`, template)).toBeNull();
    const fr = runToText(run('run-bbbbbb', 'Référence'), 'fr');
    expect(withResultsTemplate(fr, template)).toBe(`${template.trim()}\n\n${fr}`);
  });
});

describe('combining runs from two versions (D1, D12)', () => {
  it('combines only when the versions differ by runs that exist on one side', () => {
    const local = thesis({ runs: [run('run-aaaaaa', 'Shared'), run('run-bbbbbb', 'Only here')], log: [{ at: '2026-11-09T09:00:00.000Z', step: 'experiments', tool: 'A' }] });
    const cloud = thesis({ runs: [run('run-aaaaaa', 'Shared'), run('run-cccccc', 'Only in account')], log: [{ at: '2026-11-09T08:00:00.000Z', step: 'experiments', tool: 'B' }], savedAt: '2026-11-09T11:00:00.000Z' });
    const plan = planRunMerge(local, cloud, '2026-11-09T12:00:00.000Z');
    expect(plan.combinable).toBe(true);
    expect(plan.merged!.runs!.map((r) => r.name).sort()).toEqual(['Only here', 'Only in account', 'Shared']);
    expect(plan.merged!.log.map((l) => l.tool)).toEqual(['B', 'A']);
    expect(plan.merged!.steps).toEqual(cloud.steps);
  });
  it('refuses when anything else differs', () => {
    const local = thesis({ topic: 'Changed here', runs: [run('run-bbbbbb', 'Only here')] });
    expect(planRunMerge(local, thesis(), T)).toMatchObject({ combinable: false, reason: 'other_changes' });
  });
  it('refuses when the same run was changed in both versions', () => {
    const local = thesis({ runs: [run('run-aaaaaa', 'Name A')] });
    const cloud = thesis({ runs: [run('run-aaaaaa', 'Name B')] });
    const plan = planRunMerge(local, cloud, T);
    expect(plan).toMatchObject({ combinable: false, reason: 'edited_both' });
    expect(plan.editedBoth.map((r) => r.name)).toEqual(['Name A']);
  });
  it('flags a run edited here that the other version does not have (edit versus delete)', () => {
    const local = thesis({ runs: [run('run-aaaaaa', 'Edited here', { updatedAt: '2026-11-09T11:00:00.000Z' })] });
    const plan = planRunMerge(local, thesis({ runs: [] }), T);
    expect(plan.editedHereMissingThere.map((r) => r.name)).toEqual(['Edited here']);
    expect(plan.combinable).toBe(true);
    expect(plan.merged!.runs!.map((r) => r.name)).toEqual(['Edited here']);
  });
});
