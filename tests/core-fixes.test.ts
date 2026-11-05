import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fail, handle, openDocx, uploaded } from '@/lib/api';
import { authMessage } from '@/lib/authMessages';
import { coach, coachMessages } from '@/lib/coach';
import { COACH_LIMIT, coverageOf, EXTRACT_LIMIT, FEEDBACK_LIMIT, MAX_UPLOAD_BYTES } from '@/lib/limits';
import { chatJson } from '@/lib/llm';
import { applySituation, emptyPath, isPathState, STEPS, type PathState } from '@/lib/path';
import { clearLocalCopy, confirmSynced, decideSync, isDirty, keepAccount, keepLocal, PATH_KEY, pushNow, readLocalPath, readSync, REPLACED_KEY, SYNC_KEY, syncNow, type CloudApi, type CloudPath } from '@/lib/pathSync';
import { pdfPages } from '@/lib/profiles';
import { PublicError } from '@/lib/publicError';
import { reviewChapter } from '@/lib/feedback';
import { verifyReferences } from '@/lib/references';
import { buildSyntheticPdf } from './helpers/syntheticThesis';

const U = 'user-1';
const mk = (savedAt: string, work = 'w'): PathState => ({ ...emptyPath(), started: true, savedAt, steps: { title: { work, checks: [], status: 'open' } } });
const cloud = (p: PathState | null, version = 'v1'): CloudPath => ({ data: p, version });

function fakeStorage() {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) });
  return m;
}
function fakeCloud(start: CloudPath | null = null) {
  const s = { row: start, n: 1, fail: false, saves: 0 };
  const api: CloudApi = {
    async load() {
      if (s.fail) throw new Error('down');
      return s.row;
    },
    async save(_u, path, base) {
      if (s.fail) throw new Error('down');
      if ((s.row?.version ?? null) !== base) return { status: 'conflict' };
      s.saves++;
      s.row = { data: path, version: `v${++s.n}` };
      return { status: 'saved', version: s.row.version };
    },
  };
  return { api, s };
}
const seedLocal = (m: Map<string, string>, p: PathState, rec?: unknown) => {
  m.set(PATH_KEY, JSON.stringify(p));
  if (rec) m.set(SYNC_KEY, JSON.stringify(rec));
};

afterEach(() => vi.unstubAllGlobals());

describe('decideSync', () => {
  const a = mk('2026-01-01', 'a');
  const b = mk('2026-01-02', 'b');
  const rec = (version: string | null, savedAt: string | null, userId = U) => ({ userId, version, savedAt });
  it.each([
    ['nothing anywhere', null, null, null, 'none'],
    ['guest work, empty account', a, null, null, 'push'],
    ['new device, account has work', null, cloud(b), null, 'adopt'],
    ['same content', a, cloud(a), null, 'in_sync'],
    ['guest work against different account work', a, cloud(b), null, 'conflict'],
    ['only this browser changed', b, cloud(a, 'v1'), rec('v1', '2026-01-01'), 'push'],
    ['only the account changed', a, cloud(b, 'v2'), rec('v1', '2026-01-01'), 'adopt'],
    ['both changed', b, cloud(mk('2026-01-03', 'c'), 'v2'), rec('v1', '2026-01-01'), 'conflict'],
    ['work from another account, empty account', a, null, rec('v1', '2026-01-01', 'other'), 'conflict'],
    ['work from another account, other work', a, cloud(b), rec('v1', '2026-01-01', 'other'), 'conflict'],
  ] as const)('%s', (_n, local, c, r, want) => {
    expect(decideSync(local, c, r, U)).toBe(want);
  });
  it('treats a blank unstarted path as no work', () => {
    expect(decideSync(emptyPath(), cloud(b), null, U)).toBe('adopt');
    expect(decideSync(emptyPath(), null, null, U)).toBe('none');
  });
  it('ignores key order from the database', () => {
    const reordered = JSON.parse(JSON.stringify({ log: a.log, steps: a.steps, current: a.current, defenseDate: '', discipline: '', topic: '', started: true, savedAt: a.savedAt }));
    expect(decideSync(a, cloud(reordered), null, U)).toBe('in_sync');
  });
  it('an old cloud row with no savedAt never beats unsynced local work', () => {
    const { savedAt: _, ...old } = mk('x', 'old');
    expect(decideSync(a, cloud(old as PathState), null, U)).toBe('conflict');
  });
});

describe('sync engine', () => {
  let m: Map<string, string>;
  beforeEach(() => { m = fakeStorage(); });

  it('uploads guest work and records the version', async () => {
    seedLocal(m, mk('t1'));
    const { api, s } = fakeCloud();
    expect(await syncNow(U, api)).toEqual({ state: 'synced' });
    expect(s.row?.data?.savedAt).toBe('t1');
    expect(readSync()).toEqual({ userId: U, version: 'v2', savedAt: 't1' });
    expect(isDirty(readLocalPath(), readSync(), U)).toBe(false);
  });
  it('pushes only when something changed', async () => {
    seedLocal(m, mk('t1'), { userId: U, version: 'v1', savedAt: 't1' });
    const { api, s } = fakeCloud(cloud(mk('t1')));
    await pushNow(U, api);
    expect(s.saves).toBe(0);
  });
  it('a stale save becomes a conflict and overwrites nothing', async () => {
    const newest = mk('t3', 'newest');
    seedLocal(m, mk('t2', 'stale edit'), { userId: U, version: 'v1', savedAt: 't1' });
    const { api, s } = fakeCloud(cloud(newest, 'v9'));
    const r = await pushNow(U, api);
    expect(r.state).toBe('conflict');
    expect(s.row?.data?.savedAt).toBe('t3');
    expect(readLocalPath()?.steps.title.work).toBe('stale edit');
  });
  it('keeping this browser sets the account copy aside first', async () => {
    seedLocal(m, mk('t2', 'mine'));
    const { api, s } = fakeCloud(cloud(mk('t3', 'theirs'), 'v9'));
    await keepLocal(U, api, s.row!.data, 'v9');
    expect(s.row?.data?.steps.title.work).toBe('mine');
    expect(m.get(REPLACED_KEY)).toContain('theirs');
  });
  it('keeping the account sets this browser aside first', () => {
    seedLocal(m, mk('t2', 'mine'));
    const next = keepAccount(U, mk('t3', 'theirs'), 'v9', emptyPath());
    expect(next.steps.title.work).toBe('theirs');
    expect(readLocalPath()?.steps.title.work).toBe('theirs');
    expect(m.get(REPLACED_KEY)).toContain('mine');
  });
  it('sign-out is confirmed only when the work is saved', async () => {
    seedLocal(m, mk('t1'));
    const { api, s } = fakeCloud();
    s.fail = true;
    expect(await confirmSynced(U, api)).toBe('failed');
    expect(readLocalPath()).not.toBeNull();
    s.fail = false;
    expect(await confirmSynced(U, api)).toBe('ok');
    expect(s.row).not.toBeNull();
  });
  it('sign-out reports a conflict instead of clearing', async () => {
    seedLocal(m, mk('t1', 'mine'));
    const { api } = fakeCloud(cloud(mk('t2', 'theirs')));
    expect(await confirmSynced(U, api)).toBe('conflict');
    expect(readLocalPath()?.steps.title.work).toBe('mine');
  });
  it('sign-out needs no network when nothing is unsaved', async () => {
    seedLocal(m, mk('t1'), { userId: U, version: 'v1', savedAt: 't1' });
    const { api, s } = fakeCloud();
    s.fail = true;
    expect(await confirmSynced(U, api)).toBe('ok');
  });
  it('clears every local copy', () => {
    seedLocal(m, mk('t1'), { userId: U, version: 'v1', savedAt: 't1' });
    m.set(REPLACED_KEY, 'x');
    clearLocalCopy();
    expect(m.size).toBe(0);
  });
  it('keeps path:v1 as a plain PathState', async () => {
    seedLocal(m, mk('t1'));
    await syncNow(U, fakeCloud().api);
    expect(isPathState(JSON.parse(m.get('path:v1')!))).toBe(true);
    expect(Object.keys(JSON.parse(m.get('path:v1')!))).not.toContain('version');
  });
});

describe('error messages', () => {
  const body = (r: Response) => r.json() as Promise<{ error: string }>;
  it('never returns internal details', async () => {
    const r = handle(new Error("Cannot find module '/var/task/node_modules/pdfjs-dist/x.mjs'"));
    expect(r.status).toBe(500);
    expect((await body(r)).error).not.toMatch(/var\/task|node_modules|module/);
  });
  it('shows messages written for students', async () => {
    const r = handle(new PublicError('A plain message', 422));
    expect(r.status).toBe(422);
    expect((await body(r)).error).toBe('A plain message');
  });
  it('explains the AI when it is not set up', async () => {
    const r = handle(await chatJson([], { baseUrl: '', apiKey: '', model: '' }).catch((e) => e));
    expect(r.status).toBe(503);
    expect((await body(r)).error).toContain('Account');
  });
  it('explains a damaged Word file', async () => {
    await expect(openDocx(new TextEncoder().encode('not a zip'))).rejects.toThrow("We couldn't open this document. Please save it again as DOCX and try again.");
  });
  it('explains a damaged PDF', async () => {
    await expect(pdfPages(new TextEncoder().encode('not a pdf '.repeat(20)))).rejects.toThrow("We couldn't open this PDF");
  });
  it('states the true upload limit', async () => {
    const f = new FormData();
    f.set('file', new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], 'x.docx'));
    const r = await uploaded(f);
    expect('error' in r && r.error).toContain('4 MB');
    expect('status' in r && r.status).toBe(413);
    expect(MAX_UPLOAD_BYTES).toBeLessThan(4_500_000);
  });
  it('explains an unreachable AI service', async () => {
    const down = (async () => { throw new Error('getaddrinfo ENOTFOUND internal.host'); }) as unknown as typeof fetch;
    await expect(chatJson([], { baseUrl: 'http://x', apiKey: 'k', model: 'm', fetchImpl: down })).rejects.toThrow("couldn't reach your AI service");
  });
  it('explains an unreadable AI reply', async () => {
    const odd = (async () => new Response(JSON.stringify({ choices: [{ message: { content: 'no json here' } }] }))) as typeof fetch;
    await expect(chatJson([], { baseUrl: 'http://x', apiKey: 'k', model: 'm', fetchImpl: odd })).rejects.toThrow('could not read');
  });
  it('words Crossref limits plainly', async () => {
    const busy = (async () => new Response('', { status: 429 })) as unknown as typeof fetch;
    const [r] = await verifyReferences(['Fiction A. A long enough fictional title. 2024'], busy);
    expect(r.status).toBe('unchecked');
    expect(r.note).not.toMatch(/429/);
  });
  it('maps Auth errors without leaking', () => {
    expect(authMessage({ name: 'AuthRetryableFetchError', status: 0 }, 'sign_in')).toContain("couldn't reach");
    expect(authMessage({ code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' }, 'sign_in')).toContain('reset your password');
    expect(authMessage({ code: 'unexpected', status: 500, message: 'pg: relation x missing' }, 'sign_up')).not.toContain('relation');
  });
  it('fail keeps its status', () => {
    expect(fail('x', 413).status).toBe(413);
  });
});

describe('coverage', () => {
  const step = STEPS[0];
  const reply = (obj: unknown) => (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(obj) } }] }))) as typeof fetch;
  const ready = { verdict: 'ready', summary: 's', criteria: (step.standards ?? []).map((standard) => ({ standard, status: 'met', comment: 'c' })) };
  const cfg = { baseUrl: 'http://x', apiKey: 'k', model: 'm' };

  it('keeps the limits unchanged', () => {
    expect([EXTRACT_LIMIT, COACH_LIMIT, FEEDBACK_LIMIT]).toEqual([60000, 20000, 40000]);
  });
  it('counts what was read', () => {
    expect(coverageOf('abc', 2)).toEqual({ totalChars: 3, readChars: 2, complete: false });
    expect(coverageOf('ab', 2)).toEqual({ totalChars: 2, readChars: 2, complete: true });
  });
  it('tells the model only when text was shortened', () => {
    const input = { step, degree: 'master_academic' as const, work: 'short' };
    expect(coachMessages(input)[1].content).not.toContain('Only the first');
    const long = coachMessages({ ...input, work: 'x'.repeat(COACH_LIMIT + 5) })[1].content;
    expect(long).toContain(`Only the first ${COACH_LIMIT} of ${COACH_LIMIT + 5} characters`);
  });
  it('a full read keeps a ready verdict', async () => {
    const r = await coach({ step, degree: 'master_academic', work: 'short' }, { ...cfg, fetchImpl: reply(ready) });
    expect(r.coverage?.complete).toBe(true);
    if (step.standards?.length) expect(r.verdict).toBe('ready');
  });
  it('a partial read cannot be ready', async () => {
    const r = await coach({ step, degree: 'master_academic', work: 'x'.repeat(COACH_LIMIT + 1) }, { ...cfg, fetchImpl: reply({ ...ready, verdict: 'ready' }) });
    expect(r.coverage?.complete).toBe(false);
    expect(r.verdict).not.toBe('ready');
  });
  it('chapter feedback reports coverage', async () => {
    const r = await reviewChapter({ degree: 'master_academic', title: 'T', text: 'x'.repeat(FEEDBACK_LIMIT + 1) }, { ...cfg, fetchImpl: reply({ summary: 's' }) });
    expect(r.coverage).toEqual({ totalChars: FEEDBACK_LIMIT + 1, readChars: FEEDBACK_LIMIT, complete: false });
  });
  it('import details stay optional and survive a save', () => {
    const p = applySituation(emptyPath(), 'full', { text: 'draft', imported: { file: 'f.docx', extractedChars: 60000, totalChars: 90000 } });
    expect(isPathState(JSON.parse(JSON.stringify(p)))).toBe(true);
    expect(p.steps.revise.imported?.totalChars).toBe(90000);
    expect(applySituation(emptyPath(), 'full', { text: 'draft' }).steps.revise.imported).toBeUndefined();
  });
});

describe('PDF', () => {
  it('reads a synthetic PDF', async () => {
    expect((await pdfPages(buildSyntheticPdf(['Fictional words on a page.'])))[0]).toContain('Fictional words');
  });
});

describe('open questions', () => {
  it('keeps earlier notes and a step template', async () => {
    const { addOpenQuestion } = await import('@/lib/path');
    expect(addOpenQuestion('Notes', 'Task', ' Why? ')).toBe('Notes\n\nOpen question (Task): Why?');
    expect(addOpenQuestion('', 'Task', 'Why?', 'Template')).toBe('Template\n\nOpen question (Task): Why?');
    expect(addOpenQuestion('', 'Task', 'Why?')).toBe('Open question (Task): Why?');
  });
});
