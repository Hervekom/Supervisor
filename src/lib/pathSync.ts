import { cleanLab, hasLabProgress, newerLab, type LabState } from './lab';
import { LAB_MIRROR_KEY, LAB_V1_KEY, readLabFor, removeLabFor } from './labOwner';
import { isPathState, type PathState } from './path';

export const PATH_KEY = 'path:v1';
/** Which account version this browser's copy came from. `path:v1` itself keeps its format. */
export const SYNC_KEY = 'path:sync:v1';
/** The copy set aside when a student chooses between two versions. */
export const REPLACED_KEY = 'path:replaced:v1';
/** The conversation stays in this browser. */
export const CHEF_KEY = 'chef:v1';
/** Earlier Lab formats. They stay readable and are now unowned: see labOwner.ts. */
export { LAB_MIRROR_KEY, LAB_V1_KEY };

export type CloudPath = { data: PathState | null; version: string };
export type SaveResult = { status: 'saved'; version: string } | { status: 'conflict' };
export type CloudApi = {
  load(userId: string): Promise<CloudPath | null>;
  save(userId: string, path: PathState, baseVersion: string | null): Promise<SaveResult>;
};
export type SyncRecord = { userId: string; version: string | null; savedAt: string | null };
export type SyncAction = 'none' | 'in_sync' | 'adopt' | 'push' | 'conflict';
export type SyncOutcome =
  | { state: 'synced' }
  | { state: 'adopted'; path: PathState }
  | { state: 'conflict'; cloud: PathState | null; version: string | null };

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
    return true;
  } catch {
    return false;
  }
};
const parse = (raw: string | null): unknown => {
  try {
    return JSON.parse(raw ?? 'null');
  } catch {
    return null;
  }
};

export function readLocalPath(): PathState | null {
  const v = parse(read(PATH_KEY));
  return isPathState(v) ? v : null;
}
export const writeLocalPath = (p: PathState) => write(PATH_KEY, JSON.stringify(p));

export function readSync(): SyncRecord | null {
  const v = parse(read(SYNC_KEY)) as SyncRecord | null;
  return v && typeof v.userId === 'string' ? v : null;
}
const writeSync = (r: SyncRecord) => write(SYNC_KEY, JSON.stringify(r));
const stamp = (userId: string, version: string | null, p: PathState | null) => writeSync({ userId, version, savedAt: p?.savedAt ?? null });

/** Earlier set-aside copies, newest first. A new conflict never overwrites them silently. */
export const REPLACED_LIST_KEY = 'path:replaced:list:v1';
export const MAX_SET_ASIDE = 5;
/** `owner` is the account the copy was set aside for. Copies from before owners existed have none. */
export type SetAside = { at: string; path: PathState; owner?: string };

/** Thrown instead of dropping an older copy when the list is full. The student must export or remove one first. */
export class SetAsideFullError extends Error {
  constructor() {
    super('set_aside_full');
  }
}

const sameCopy = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Every set-aside copy in this browser, including one written by an older version of the app. */
export function readSetAside(): SetAside[] {
  const v = parse(read(REPLACED_LIST_KEY));
  const list = Array.isArray(v) ? (v as SetAside[]).filter((x) => x && typeof x.at === 'string' && isPathState(x.path)).map((x) => ({ at: x.at, path: x.path, ...(typeof x.owner === 'string' ? { owner: x.owner } : {}) })) : [];
  const single = parse(read(REPLACED_KEY));
  if (isPathState(single) && !list.some((x) => sameCopy(x.path, single))) list.push({ at: single.savedAt ?? '', path: single });
  return list;
}

/** The copies a signed-in account may see: its own, and those with no owner. */
export const setAsideFor = (userId: string | undefined) => readSetAside().filter((x) => !x.owner || x.owner === userId);
/** Room left for this account. The limit counts only copies this account can see and remove. */
export const setAsideRoom = (userId?: string) => MAX_SET_ASIDE - setAsideFor(userId).length;

/** Sets a copy aside. Never drops an older copy: when the list is full it throws, and nothing changes. */
export const setAside = (p: PathState | null, now = new Date().toISOString(), owner?: string) => {
  if (!p) return;
  const list = readSetAside();
  if (list.some((x) => sameCopy(x.path, p))) return;
  if (list.filter((x) => !x.owner || x.owner === owner).length >= MAX_SET_ASIDE) throw new SetAsideFullError();
  write(REPLACED_LIST_KEY, JSON.stringify([{ at: now, path: p, ...(owner ? { owner } : {}) }, ...list]));
  write(REPLACED_KEY, JSON.stringify(p));
};

/** Removes one set-aside copy, only after the student chose to. */
export function removeSetAside(copy: SetAside) {
  const list = readSetAside().filter((x) => !(x.at === copy.at && sameCopy(x.path, copy.path)));
  write(REPLACED_LIST_KEY, JSON.stringify(list));
  if (sameCopy(parse(read(REPLACED_KEY)), copy.path)) {
    try {
      localStorage.removeItem(REPLACED_KEY);
    } catch {}
  }
}

/** A file holding set-aside copies, for the student to keep. */
export const exportSetAside = (copies: SetAside[], now = new Date().toISOString()) => JSON.stringify({ exportedAt: now, note: 'Versions of your Supervisor work that were set aside after a choice between two versions.', copies }, null, 2);

/**
 * Only called once the account is confirmed to hold the work, or the student chose what to keep.
 * `keepLab` keeps this owner's Lab progress. `keepSetAside` keeps the set-aside copies.
 * Lab progress of other owners, and unowned progress from earlier versions, is never removed here.
 */
export function clearLocalCopy(opts: { keepLab?: boolean; keepSetAside?: boolean; labOwner?: string; userId?: string } = {}) {
  try {
    localStorage.removeItem(PATH_KEY);
    localStorage.removeItem(SYNC_KEY);
    localStorage.removeItem(CHEF_KEY);
  } catch {}
  // Only this account's set-aside copies, and copies with no owner, are removed, and only when the student chose to.
  if (!opts.keepSetAside) {
    for (const c of setAsideFor(opts.userId)) removeSetAside(c);
    // A legacy single copy that cannot be read holds no work and is removed with the rest.
    if (!isPathState(parse(read(REPLACED_KEY)))) {
      try {
        localStorage.removeItem(REPLACED_KEY);
      } catch {}
    }
  }
  if (!opts.keepLab && opts.labOwner) removeLabFor(opts.labOwner);
}

/** This owner's Lab progress kept in this browser apart from the thesis copy. */
export const readLabMirror = (owner: string): LabState | undefined => readLabFor(owner);

const sameLab = (a: LabState | undefined, b: LabState | undefined) => JSON.stringify(canonical(a ?? null)) === JSON.stringify(canonical(b ?? null));

export type LabRisk = { verified: number; marked: number; checked: number };

/**
 * Lab progress that signing out would delete: it exists in this browser but cannot reach the account,
 * because no thesis has been started (thesis-less copies are never synced, so no false conflict can start).
 */
export function labAtRisk(local: PathState | null, mirror: LabState | undefined): LabRisk | null {
  if (hasWork(local)) return null;
  const lab = newerLab(cleanLab(local?.lab), mirror);
  if (!lab || !hasLabProgress(lab)) return null;
  const tools = Object.values(lab.tools);
  const checks = tools.filter((t) => t.check);
  return { verified: checks.filter((t) => t.check!.status === 'verified').length, checked: checks.length, marked: tools.filter((t) => t.marked).length };
}

/**
 * When a thesis exists, newer Lab progress of this owner is put into the thesis copy,
 * so the normal save sends it to the account. Returns true when the thesis copy changed.
 */
export function mergeLabMirror(owner: string, now = new Date().toISOString()): boolean {
  const local = readLocalPath();
  if (!hasWork(local)) return false;
  const mirror = readLabFor(owner);
  const own = cleanLab(local!.lab);
  const best = newerLab(own, mirror);
  if (!best || !hasLabProgress(best) || sameLab(best, own)) return false;
  return writeLocalPath({ ...local!, lab: best, savedAt: now });
}

export const hasWork = (p: PathState | null) => !!p && (!!p.started || Object.keys(p.steps).length > 0);

const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, canonical(x)]))
      : v;
export const samePath = (a: PathState, b: PathState) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

export function isDirty(local: PathState | null, rec: SyncRecord | null, userId: string) {
  if (!hasWork(local)) return false;
  return !rec || rec.userId !== userId || (local?.savedAt ?? null) !== rec.savedAt;
}

/** Decides what to do with this browser's copy and the account's copy. It never discards unsynced work. */
export function decideSync(local: PathState | null, cloud: CloudPath | null, rec: SyncRecord | null, userId: string): SyncAction {
  const localWork = hasWork(local);
  const otherAccount = !!rec && rec.userId !== userId;
  if (!cloud?.data) {
    if (!localWork) return 'none';
    return otherAccount ? 'conflict' : 'push';
  }
  if (!localWork) return 'adopt';
  if (samePath(local!, cloud.data)) return 'in_sync';
  if (!rec || otherAccount) return 'conflict';
  const dirty = isDirty(local, rec, userId);
  // The same saved copy under a new version stamp is not a change, so it cannot start a false conflict.
  const cloudMoved = rec.version !== cloud.version && (cloud.data.savedAt ?? null) !== rec.savedAt;
  if (dirty) return cloudMoved ? 'conflict' : 'push';
  return cloudMoved ? 'adopt' : 'in_sync';
}

/** Compares both copies, then acts. Throws when the account cannot be reached. */
export async function syncNow(userId: string, api: CloudApi, attempt = 0): Promise<SyncOutcome> {
  const local = readLocalPath();
  const rec = readSync();
  const cloud = await api.load(userId);
  switch (decideSync(local, cloud, rec, userId)) {
    case 'none':
      return { state: 'synced' };
    case 'in_sync':
      stamp(userId, cloud!.version, local);
      return { state: 'synced' };
    case 'adopt':
      writeLocalPath(cloud!.data!);
      stamp(userId, cloud!.version, cloud!.data);
      return { state: 'adopted', path: cloud!.data! };
    case 'conflict':
      return { state: 'conflict', cloud: cloud?.data ?? null, version: cloud?.version ?? null };
    case 'push': {
      const r = await api.save(userId, local!, cloud?.version ?? null);
      if (r.status === 'saved') {
        stamp(userId, r.version, local);
        return { state: 'synced' };
      }
      if (attempt < 2) return syncNow(userId, api, attempt + 1);
      return { state: 'conflict', cloud: cloud?.data ?? null, version: cloud?.version ?? null };
    }
  }
}

/** Saves the latest edit against the version this browser last saw. */
export async function pushNow(userId: string, api: CloudApi): Promise<SyncOutcome> {
  const local = readLocalPath();
  const rec = readSync();
  if (!rec || rec.userId !== userId) return syncNow(userId, api);
  if (!isDirty(local, rec, userId)) return { state: 'synced' };
  const r = await api.save(userId, local!, rec.version);
  if (r.status === 'conflict') return syncNow(userId, api);
  stamp(userId, r.version, local);
  return { state: 'synced' };
}

/** The student keeps this browser's copy. The account's copy is set aside here first. */
export async function keepLocal(userId: string, api: CloudApi, cloud: PathState | null, version: string | null): Promise<SyncOutcome> {
  const local = readLocalPath();
  if (!local) return { state: 'synced' };
  setAside(cloud, undefined, userId);
  const r = await api.save(userId, local, version);
  if (r.status === 'conflict') return syncNow(userId, api);
  stamp(userId, r.version, local);
  return { state: 'synced' };
}

/** The student keeps the account's copy. This browser's copy is set aside first. */
export function keepAccount(userId: string, cloud: PathState | null, version: string | null, blank: PathState) {
  setAside(readLocalPath(), undefined, userId);
  const next = cloud ?? blank;
  writeLocalPath(next);
  stamp(userId, version, cloud);
  return next;
}

export type SignOutCheck = 'ok' | 'failed' | 'conflict';

/** Sign-out may clear this browser only when this returns 'ok'. */
export async function confirmSynced(userId: string, api: CloudApi): Promise<SignOutCheck> {
  if (!isDirty(readLocalPath(), readSync(), userId)) return 'ok';
  try {
    return (await syncNow(userId, api)).state === 'conflict' ? 'conflict' : 'ok';
  } catch {
    return 'failed';
  }
}
