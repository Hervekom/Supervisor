import { beforeEach, describe, expect, it } from 'vitest';
import { combineLabs, emptyLab, recordCheck, setMarked } from '@/lib/lab';
import { verifyOutput } from '@/lib/labVerify';
import {
  adoptSessionGuest,
  claimUnowned,
  exportLab,
  guestSession,
  identityFor,
  keepThesislessLab,
  LAB_MIRROR_KEY,
  LAB_OWNERS_KEY,
  LAB_V1_KEY,
  listUnowned,
  readLabFor,
  readOwners,
  removeUnowned,
  writeLabFor,
} from '@/lib/labOwner';

// B2.3.2 D-M1: Lab progress belongs to the account's stable user ID. All data is synthetic.
const local = new Map<string, string>();
const session = new Map<string, string>();
const fake = (m: Map<string, string>) => ({ getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) });
(globalThis as { localStorage?: unknown }).localStorage = fake(local);
(globalThis as { sessionStorage?: unknown }).sessionStorage = fake(session);
beforeEach(() => {
  local.clear();
  session.clear();
});

const T = '2026-11-09T10:00:00.000Z';
const W = { os: 'windows' as const, gpu: 'no' as const };
const python = (at = T) => recordCheck({ ...emptyLab(), workTypes: ['python'], os: 'windows' }, 'python', 'windows', verifyOutput('python', 'Python 3.12.7', W), at);
const git = (at = T) => setMarked({ ...emptyLab(), workTypes: ['statistics'], os: 'windows' }, 'git', true, at);

describe('owner of Lab progress', () => {
  it('uses the stable user ID, never an email', () => {
    expect(identityFor('00000000-0000-4000-8000-000000000001')).toBe('user:00000000-0000-4000-8000-000000000001');
    expect(identityFor(undefined)).toMatch(/^guest:[a-z0-9-]{8,64}$/);
    expect(identityFor(null)).toBe(`guest:${guestSession()}`);
  });
  it('two accounts in one browser each see only their own progress', () => {
    writeLabFor('user:a', python());
    expect(readLabFor('user:b')).toBeUndefined();
    writeLabFor('user:b', git());
    expect(readLabFor('user:a')?.tools.python.check?.status).toBe('verified');
    expect(readLabFor('user:a')?.tools.git).toBeUndefined();
    expect(readLabFor('user:b')?.tools.python).toBeUndefined();
  });
  it("another account's progress is never listed as something to claim", () => {
    writeLabFor('user:a', python());
    expect(listUnowned('user:b')).toEqual([]);
  });
  it('progress made signed out in the same tab moves to the account that signs in there', () => {
    const guest = identityFor(undefined);
    writeLabFor(guest, python());
    expect(adoptSessionGuest('a')).toBe(true);
    expect(readLabFor('user:a')?.tools.python.check?.status).toBe('verified');
    expect(readLabFor(guest)).toBeUndefined();
  });
  it('progress from another signed-out session is never moved, only offered', () => {
    writeLabFor('guest:othertab-123', python());
    expect(adoptSessionGuest('a')).toBe(false);
    expect(readLabFor('user:a')).toBeUndefined();
    expect(listUnowned('user:a').map((u) => [u.key, u.source])).toEqual([['guest:othertab-123', 'other_session']]);
  });
  it('adopting keeps what the account already had', () => {
    writeLabFor('user:a', git());
    writeLabFor(identityFor(undefined), python());
    adoptSessionGuest('a');
    expect(Object.keys(readLabFor('user:a')!.tools).sort()).toEqual(['git', 'python']);
  });
  it('ignores damaged owner keys and values', () => {
    local.set(LAB_OWNERS_KEY, JSON.stringify({ 'user:a': python(), 'admin:x': python(), 'user:b': 'garbage', 'user:../../x': python() }));
    expect(Object.keys(readOwners())).toEqual(['user:a']);
  });
});

describe('unowned progress from earlier versions', () => {
  it('is listed, never assigned to whoever signs in', () => {
    local.set(LAB_MIRROR_KEY, JSON.stringify(python()));
    local.set(LAB_V1_KEY, JSON.stringify({ workTypes: ['statistics'], marked: { git: true } }));
    const list = listUnowned('user:a');
    expect(list.map((u) => [u.key, u.source])).toEqual([[LAB_MIRROR_KEY, 'earlier_version'], [LAB_V1_KEY, 'earlier_version']]);
    expect(readLabFor('user:a')).toBeUndefined();
    expect(local.get(LAB_MIRROR_KEY)).toBeDefined();
  });
  it('becomes the account’s only after an explicit claim, joined with what it already had', () => {
    writeLabFor('user:a', git());
    local.set(LAB_MIRROR_KEY, JSON.stringify(python()));
    const merged = claimUnowned(LAB_MIRROR_KEY, 'user:a');
    expect(Object.keys(merged!.tools).sort()).toEqual(['git', 'python']);
    expect(readLabFor('user:a')?.tools.python.check?.status).toBe('verified');
    expect(local.has(LAB_MIRROR_KEY)).toBe(false);
  });
  it('can be exported and removed explicitly', () => {
    local.set(LAB_MIRROR_KEY, JSON.stringify(python()));
    const u = listUnowned('user:a')[0];
    const file = JSON.parse(exportLab(u));
    expect(file.lab.tools.python.check.found).toBe('Python 3.12.7');
    expect(file.source).toBe('earlier_version');
    removeUnowned(LAB_MIRROR_KEY);
    expect(listUnowned('user:a')).toEqual([]);
  });
  it('a claim of something no longer there does nothing', () => {
    expect(claimUnowned(LAB_MIRROR_KEY, 'user:a')).toBeUndefined();
    expect(readLabFor('user:a')).toBeUndefined();
  });
  it('Lab progress found in a thesis-less copy of the work is kept aside, once', () => {
    keepThesislessLab(python());
    keepThesislessLab(python());
    const list = listUnowned('user:a');
    expect(list).toHaveLength(1);
    expect(list[0].source).toBe('other_session');
    // Already known progress is not copied again.
    local.clear();
    local.set(LAB_MIRROR_KEY, JSON.stringify(python()));
    keepThesislessLab(python());
    expect(listUnowned('user:a')).toHaveLength(1);
  });
});

describe('joining two Lab states', () => {
  it('keeps every tool, the newer check and any tick', () => {
    const older = setMarked(python('2026-11-09T09:00:00.000Z'), 'git', true, '2026-11-09T09:00:00.000Z');
    const newer = recordCheck(git('2026-11-09T11:00:00.000Z'), 'python', 'windows', verifyOutput('python', 'Python 3.11.9', W), '2026-11-09T11:00:00.000Z');
    const c = combineLabs(older, newer, '2026-11-09T12:00:00.000Z')!;
    expect(c.tools.python.check?.found).toBe('Python 3.11.9');
    expect(c.tools.git.marked).toBe(true);
    expect(c.workTypes.sort()).toEqual(['python', 'statistics']);
    expect(c.updatedAt).toBe('2026-11-09T12:00:00.000Z');
  });
  it('returns the other side when one is missing', () => {
    expect(combineLabs(undefined, python())).toEqual(python());
    expect(combineLabs(python(), undefined)).toEqual(python());
  });
});

describe('a server without sign-in', () => {
  it('reads earlier progress for the browser’s single owner, and leaves the earlier copies in place', async () => {
    const { adoptLegacyWithoutAccounts, BROWSER_OWNER } = await import('@/lib/labOwner');
    local.set(LAB_V1_KEY, JSON.stringify({ workTypes: ['python'], os: 'linux', gpu: 'not_sure', marked: { git: true }, osConfirmed: true }));
    expect(adoptLegacyWithoutAccounts()).toBe(true);
    expect(readLabFor(BROWSER_OWNER)?.tools.git.marked).toBe(true);
    expect(readLabFor(BROWSER_OWNER)?.os).toBe('linux');
    expect(local.has(LAB_V1_KEY)).toBe(true);
    // A second load changes nothing.
    expect(adoptLegacyWithoutAccounts()).toBe(false);
  });
});
