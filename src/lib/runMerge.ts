// Combining two versions of the work, only when it is safe: they must differ only by experiment runs
// that exist in one version and not the other. Anything else keeps the explicit choice between versions.

import type { PathState } from './path';
import { samePath } from './pathSync';
import { cleanRuns, type RunRecord } from './runs';

export type RunMerge = {
  combinable: boolean;
  /** Why the versions cannot be combined, when they cannot. */
  reason?: 'missing' | 'other_changes' | 'edited_both' | 'no_run_difference';
  onlyHere: RunRecord[];
  onlyAccount: RunRecord[];
  /** Runs changed in both versions. Never combined automatically. */
  editedBoth: RunRecord[];
  /** Runs edited here that the other version does not have: they may have been deleted on another device. */
  editedHereMissingThere: RunRecord[];
  merged?: PathState;
};

const key = (v: unknown) => JSON.stringify(v, Object.keys((v as object) ?? {}).sort());
const canonical = (r: RunRecord) => JSON.stringify(Object.fromEntries(Object.entries(r).sort(([a], [b]) => (a < b ? -1 : 1))));
const rest = (p: PathState) => {
  const { runs: _r, savedAt: _s, log: _l, ...other } = p;
  return { ...other, log: [], savedAt: '' } as PathState;
};

export function planRunMerge(local: PathState | null, cloud: PathState | null, now = new Date().toISOString()): RunMerge {
  const empty = { onlyHere: [], onlyAccount: [], editedBoth: [], editedHereMissingThere: [] };
  if (!local || !cloud) return { combinable: false, reason: 'missing', ...empty };
  const here = cleanRuns(local.runs);
  const there = cleanRuns(cloud.runs);
  const byId = new Map(there.map((r) => [r.id, r]));
  const hereIds = new Set(here.map((r) => r.id));
  const onlyHere = here.filter((r) => !byId.has(r.id));
  const onlyAccount = there.filter((r) => !hereIds.has(r.id));
  const editedBoth = here.filter((r) => byId.has(r.id) && canonical(byId.get(r.id)!) !== canonical(r));
  const editedHereMissingThere = onlyHere.filter((r) => r.updatedAt > r.createdAt);
  const base = { onlyHere, onlyAccount, editedBoth, editedHereMissingThere };
  if (!samePath(rest(local), rest(cloud))) return { combinable: false, reason: 'other_changes', ...base };
  if (editedBoth.length) return { combinable: false, reason: 'edited_both', ...base };
  if (!onlyHere.length && !onlyAccount.length) return { combinable: false, reason: 'no_run_difference', ...base };
  const seen = new Set<string>();
  const log = [...cloud.log, ...local.log].filter((l) => (seen.has(key(l)) ? false : (seen.add(key(l)), true))).sort((a, b) => (a.at < b.at ? -1 : 1));
  const runs = [...there, ...onlyHere].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  return { combinable: true, ...base, merged: { ...cloud, runs, log, savedAt: now } };
}
