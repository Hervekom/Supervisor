import { isPathState, type PathState } from './path';

export const PATH_KEY = 'path:v1';
/** Which account version this browser's copy came from. `path:v1` itself keeps its format. */
export const SYNC_KEY = 'path:sync:v1';
/** The copy set aside when a student chooses between two versions. */
export const REPLACED_KEY = 'path:replaced:v1';
/** The conversation stays in this browser. */
export const CHEF_KEY = 'chef:v1';
/** Browser copy of the Lab progress, kept so it survives when the account's copy replaces this browser's. */
export const LAB_MIRROR_KEY = 'lab:v2';
/** Lab progress from before it was saved with the thesis. Read once, never written. */
export const LAB_V1_KEY = 'lab:v1';

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

export const setAside = (p: PathState | null) => {
  if (p) write(REPLACED_KEY, JSON.stringify(p));
};

/** Only called once the account is confirmed to hold the work, or the student chose to leave it. */
export function clearLocalCopy() {
  try {
    localStorage.removeItem(PATH_KEY);
    localStorage.removeItem(SYNC_KEY);
    localStorage.removeItem(REPLACED_KEY);
    localStorage.removeItem(CHEF_KEY);
    localStorage.removeItem(LAB_MIRROR_KEY);
    localStorage.removeItem(LAB_V1_KEY);
  } catch {}
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
  setAside(cloud);
  const r = await api.save(userId, local, version);
  if (r.status === 'conflict') return syncNow(userId, api);
  stamp(userId, r.version, local);
  return { state: 'synced' };
}

/** The student keeps the account's copy. This browser's copy is set aside first. */
export function keepAccount(userId: string, cloud: PathState | null, version: string | null, blank: PathState) {
  setAside(readLocalPath());
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
