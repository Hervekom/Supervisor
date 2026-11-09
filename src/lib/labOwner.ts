// Lab progress kept in this browser, by owner. An owner is the account's stable user ID ("user:<id>"),
// or a signed-out session in one browser tab ("guest:<random>"). Progress never moves between owners by itself.
// Progress saved before owners existed (lab:v1, lab:v2) is unowned: it is only used after the student claims it.

import { cleanLab, combineLabs, fromLabV1, hasLabProgress, type LabState } from './lab';

export const LAB_OWNERS_KEY = 'lab:owners:v1';
/** Earlier formats, read only. */
export const LAB_MIRROR_KEY = 'lab:v2';
export const LAB_V1_KEY = 'lab:v1';
const SESSION_KEY = 'lab:guest-session:v1';

const ls = () => {
  try {
    return localStorage;
  } catch {
    return null;
  }
};
const ss = () => {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
};
const parse = (raw: string | null | undefined): unknown => {
  try {
    return JSON.parse(raw ?? 'null');
  } catch {
    return null;
  }
};

/** The signed-out session of this browser tab. It ends when the tab closes. */
export function guestSession(): string {
  const s = ss();
  let id = s?.getItem(SESSION_KEY) ?? '';
  if (!/^[a-z0-9-]{8,64}$/.test(id)) {
    id = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
    try {
      s?.setItem(SESSION_KEY, id);
    } catch {}
  }
  return id;
}
export const identityFor = (userId?: string | null) => (userId ? `user:${userId}` : `guest:${guestSession()}`);
/**
 * When this server has no sign-in at all, the browser has a single user and no account can ever take the progress.
 * All progress then belongs to this one owner, as it did before owners existed.
 */
export const BROWSER_OWNER = 'guest:this-browser';
export const isUserIdentity = (id: string) => id.startsWith('user:');

type Owners = Record<string, LabState>;
export function readOwners(): Owners {
  const v = parse(ls()?.getItem(LAB_OWNERS_KEY));
  const out: Owners = {};
  if (v && typeof v === 'object' && !Array.isArray(v))
    for (const [k, lab] of Object.entries(v as Record<string, unknown>).slice(0, 50)) {
      const c = cleanLab(lab);
      if (/^(user|guest):[A-Za-z0-9-]{1,80}$/.test(k) && c) out[k] = c;
    }
  return out;
}
const writeOwners = (o: Owners) => {
  try {
    ls()?.setItem(LAB_OWNERS_KEY, JSON.stringify(o));
    return true;
  } catch {
    return false;
  }
};

export const readLabFor = (owner: string): LabState | undefined => readOwners()[owner];
export function writeLabFor(owner: string, lab: LabState) {
  if (!hasLabProgress(lab)) return false;
  return writeOwners({ ...readOwners(), [owner]: lab });
}
export function removeLabFor(owner: string) {
  const o = readOwners();
  if (!(owner in o)) return;
  delete o[owner];
  writeOwners(o);
}

/**
 * Signing in from the same browser tab continues the same person's work, so progress made
 * signed-out in this tab moves to the account. Progress from any other session is never moved.
 */
export function adoptSessionGuest(userId: string): boolean {
  const o = readOwners();
  const guest = `guest:${guestSession()}`;
  const g = o[guest];
  if (!g) return false;
  const user = `user:${userId}`;
  const merged = combineLabs(o[user], g);
  if (merged) o[user] = merged;
  delete o[guest];
  return writeOwners(o);
}

/** Progress in this browser that belongs to no one the current owner can prove to be. */
export type Unowned = { key: string; source: 'earlier_version' | 'other_session'; lab: LabState; updatedAt: string };
export function listUnowned(current: string): Unowned[] {
  const out: Unowned[] = [];
  const store = ls();
  const v2 = cleanLab(parse(store?.getItem(LAB_MIRROR_KEY)));
  if (v2 && hasLabProgress(v2)) out.push({ key: LAB_MIRROR_KEY, source: 'earlier_version', lab: v2, updatedAt: v2.updatedAt });
  const v1 = fromLabV1(parse(store?.getItem(LAB_V1_KEY)));
  if (v1 && hasLabProgress(v1)) out.push({ key: LAB_V1_KEY, source: 'earlier_version', lab: v1, updatedAt: v1.updatedAt });
  for (const [k, lab] of Object.entries(readOwners())) if (k.startsWith('guest:') && k !== current && hasLabProgress(lab)) out.push({ key: k, source: 'other_session', lab, updatedAt: lab.updatedAt });
  return out;
}

/** Removes one unowned copy. Only called after the student chose to claim or discard it. */
export function removeUnowned(key: string) {
  if (key === LAB_MIRROR_KEY || key === LAB_V1_KEY) {
    try {
      ls()?.removeItem(key);
    } catch {}
    return;
  }
  if (key.startsWith('guest:')) removeLabFor(key);
}

/** The student chose to use an unowned copy: it becomes theirs, and the unowned copy is removed. */
export function claimUnowned(key: string, current: string): LabState | undefined {
  const item = listUnowned(current).find((u) => u.key === key);
  if (!item) return undefined;
  const mine = readLabFor(current);
  // Nothing from either side is dropped: a claim adds the claimed tools to the student's own.
  const merged = combineLabs(mine, item.lab) ?? item.lab;
  writeLabFor(current, merged);
  removeUnowned(key);
  return merged;
}

/**
 * Only for a server without sign-in, where no account exists to take the progress: progress saved before owners
 * existed is read for the browser's single owner. The earlier copies are left in place, never removed.
 */
export function adoptLegacyWithoutAccounts(): boolean {
  let mine = readLabFor(BROWSER_OWNER);
  let changed = false;
  for (const u of listUnowned(BROWSER_OWNER)) {
    if (u.source !== 'earlier_version') continue;
    const has = (id: string) => !!mine?.tools[id];
    if (mine && Object.keys(u.lab.tools).every(has) && u.lab.workTypes.every((w) => mine!.workTypes.includes(w))) continue;
    const merged = combineLabs(mine, u.lab);
    if (merged) {
      mine = { ...merged, os: mine?.os ?? u.lab.os, osConfirmed: (mine?.osConfirmed ?? false) || u.lab.osConfirmed, gpu: mine?.gpu ?? u.lab.gpu };
      changed = true;
    }
  }
  return changed && !!mine && writeLabFor(BROWSER_OWNER, mine);
}

export const exportLab = (u: Unowned) => JSON.stringify({ exportedAt: new Date().toISOString(), source: u.source, lab: u.lab }, null, 2);

/**
 * Keeps the Lab part of a thesis-less copy of the work before it is set aside from view,
 * so progress from earlier versions is never destroyed. It joins the unowned progress the student can claim.
 */
export function keepThesislessLab(lab: LabState | undefined) {
  if (!lab || !hasLabProgress(lab)) return;
  const same = (x: LabState) => JSON.stringify(x.tools) === JSON.stringify(lab.tools) && JSON.stringify(x.workTypes) === JSON.stringify(lab.workTypes);
  if (Object.values(readOwners()).some(same)) return;
  const v2 = cleanLab(parse(ls()?.getItem(LAB_MIRROR_KEY)));
  if (v2 && same(v2)) return;
  writeLabFor(`guest:kept-${Date.now().toString(36)}`, lab);
}
