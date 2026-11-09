import { cleanLab, currentCheck, hasLabProgress } from './lab';
import { STEPS, type PathState } from './path';
import { cleanRuns } from './runs';

/** What the Lab holds, shown on the Document page. It only counts records; it never writes thesis text. */
export function researchCounts(path: PathState) {
  const lab = cleanLab(path.lab);
  const tools = Object.values(lab?.tools ?? {});
  // A check counts only for the system chosen now and the current rules, as in the Lab.
  const checks = tools.map((x) => currentCheck(x, lab?.os ?? x.check?.os ?? null));
  const verified = checks.filter((c) => c?.status === 'verified');
  const attention = checks.filter((c) => c?.status === 'failed' || c?.status === 'manual_review').length;
  const pending = tools.filter((x, i) => x.marked && !checks[i]).length;
  const latest = verified.map((c) => c!.at).sort().at(-1) ?? null;
  const runs = cleanRuns(path.runs);
  const byStep = STEPS.map((s) => ({ id: s.id, n: runs.filter((r) => r.stepId === s.id).length })).filter((x) => x.n > 0);
  return {
    hasLab: hasLabProgress(lab),
    verified: verified.length,
    pending,
    attention,
    latest,
    runs: runs.length,
    completed: runs.filter((r) => r.outcome === 'completed').length,
    failed: runs.filter((r) => r.outcome === 'failed').length,
    linked: runs.filter((r) => r.stepId).length,
    unassigned: runs.filter((r) => !r.stepId).length,
    byStep,
  };
}

