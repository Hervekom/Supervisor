import { describe, expect, it } from 'vitest';
import { aiLanguage, isLang, MESSAGES_BY_LANG, STEP_TITLES_FR, t } from '@/lib/i18n';
import { emptyLab, recordCheck, setMarked, statusLabel } from '@/lib/lab';
import { explain, verifyOutput } from '@/lib/labVerify';
import { applySituation, emptyPath, isPathState, STEPS } from '@/lib/path';
import { researchCounts } from '@/lib/research';
import { normalizeRunFeedback, runMessages } from '@/lib/runFeedback';
import { cleanRun, cleanRuns, emptyDraft, isStepId, newRun, parseMetricsFile, runProblems, runToText, stepTitle } from '@/lib/runs';
import { textOf } from '@/lib/software';
import { loadCatalogue } from '@/lib/softwareCatalog';

const T = '2026-11-09T10:00:00.000Z';
const W = { os: 'windows' as const, gpu: 'no' as const };

/** Every key and nested key, with the type of each value. */
function shape(v: unknown, prefix = ''): string[] {
  if (typeof v === 'function') return [`${prefix}:fn${v.length}`];
  if (Array.isArray(v)) return [`${prefix}:array${v.length}`];
  if (v && typeof v === 'object') return Object.keys(v).sort().flatMap((k) => shape((v as Record<string, unknown>)[k], `${prefix}.${k}`));
  return [`${prefix}:${typeof v}`];
}

describe('dictionaries', () => {
  it('French has exactly the same keys, lists and function signatures as English', () => {
    expect(shape(MESSAGES_BY_LANG.fr)).toEqual(shape(MESSAGES_BY_LANG.en));
  });
  it('every French text is filled in', () => {
    const empty = shape(MESSAGES_BY_LANG.fr).length;
    expect(empty).toBeGreaterThan(150);
    const walk = (v: unknown, at: string): string[] =>
      typeof v === 'string' ? (v.trim() ? [] : [at]) : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => walk(x, `${at}.${k}`)) : [];
    // A text may be empty only where English is empty too, such as a field with no hint.
    const enEmpty = walk(MESSAGES_BY_LANG.en, 'x');
    expect(enEmpty.length).toBeGreaterThan(0);
    expect(walk(MESSAGES_BY_LANG.fr, 'x')).toEqual(enEmpty);
  });
  it('English is the default, and only known languages are accepted', () => {
    expect(t()).toBe(MESSAGES_BY_LANG.en);
    expect(isLang('fr')).toBe(true);
    expect(isLang('de')).toBe(false);
    expect(isLang(null)).toBe(false);
  });
  it('sends French to the AI only when French was chosen; anything else is English', () => {
    expect(aiLanguage('fr')).toBe('French');
    expect(aiLanguage('French')).toBe('French');
    expect(aiLanguage('en')).toBe('English');
    expect(aiLanguage(undefined)).toBe('English');
    expect(aiLanguage('Klingon')).toBe('English');
  });
  it('has a French title for each of the 21 steps, without changing the IDs or their order', () => {
    expect(STEPS.map((s) => s.id)).toEqual(['title', 'topic', 'literature', 'proposal', 'method', 'alignment', 'research', 'experiments', 'evidence', 'mid_term', 'paper', 'outline', 'draft', 'revise', 'references', 'pre_defense', 'submission', 'blind_review', 're_review', 'defense', 'archive']);
    expect(Object.keys(STEP_TITLES_FR).sort()).toEqual(STEPS.map((s) => s.id).sort());
    expect(stepTitle('experiments', 'fr')).toBe('Entraîner vos modèles');
    expect(stepTitle('experiments')).toBe('Train your models');
    expect(stepTitle('not_a_step', 'fr')).toBe('');
  });
});

describe('French catalogue', () => {
  const catalogue = loadCatalogue();
  it('every entry has a French text for every English text, with the same structure', () => {
    for (const e of catalogue) {
      const fr = e.i18n?.fr;
      expect(fr, e.id).toBeTruthy();
      for (const os of e.os) {
        expect(fr!.install[os]?.length, `${e.id} ${os}`).toBe(e.install[os]?.length);
        if (e.verify_manual) expect(fr!.verify_manual, e.id).toBeTruthy();
        else expect(fr!.expected[os], `${e.id} ${os}`).toBeTruthy();
      }
      expect(fr!.common_problems).toHaveLength(e.common_problems.length);
      expect(fr!.purpose).not.toBe(e.purpose);
    }
  });
  it('translates only what students read: commands, links and names stay the same', () => {
    for (const e of catalogue) {
      const fr = textOf(e, 'fr');
      for (const os of e.os) for (const i of (e.install[os] ?? []).keys()) expect(typeof fr.install[os]![i]).toBe('string');
      expect(JSON.stringify(e.i18n)).not.toMatch(/"command"|https?:/);
    }
    const py = catalogue.find((e) => e.id === 'python')!;
    expect(textOf(py, 'fr').install.windows![1]).toContain('3.13');
    expect(textOf(py, 'en')).toMatchObject({ purpose: py.purpose });
  });
});

describe('translated messages', () => {
  it('status labels and verification reasons', () => {
    expect(statusLabel('verified', 'fr')).toBe('Vérifié');
    expect(statusLabel('verified')).toBe('Verified');
    expect(explain('unrelated', 'git --version', 'fr').text).toBe('Cela ne ressemble pas au résultat de git --version.');
    expect(explain('missing_module:numpy', 'x', 'fr').next).toContain('python -m pip install numpy');
    expect(explain('empty', 'x').text).toBe('Paste the output first.');
  });
  it('run problems and file problems', () => {
    expect(runProblems({ ...emptyDraft() }, 'fr')).toEqual(['Donnez un nom à l’expérience, par exemple « Référence, graine 1 ».', 'Ajoutez au moins un résultat, ou indiquez que l’expérience a échoué.']);
    expect(parseMetricsFile('m.txt', 'a', 'fr').problems).toEqual(['Choisissez un fichier .csv ou .json.']);
    expect(parseMetricsFile('m.json', '{"note":"x"}', 'fr').problems[0]).toBe('« note » n’a pas de nombre et a été ignoré.');
  });
  it('results sheet text in French keeps names, values and the student-reported label', () => {
    const r = newRun({ ...emptyDraft(), stepId: 'experiments', name: 'Baseline, seed 1', metrics: [{ name: 'accuracy', value: 0.912, split: 'test' }] }, T, 'run-123456');
    expect(runToText(r, 'fr')).toBe('Expérience : Baseline, seed 1 (saisie par l’étudiant, 2026-11-09)\nÉtape : Entraîner vos modèles\nRésultats : accuracy (test) = 0,912'.replace(/ :/g, ':'));
    expect(runToText(r)).toBe('Run: Baseline, seed 1 (reported by the student, 2026-11-09)\nStep: Train your models\nResults: accuracy (test) = 0.912');
  });
});

describe('runs and steps', () => {
  it('a run may have a step, no step, or an invalid step that is dropped while the run is kept', () => {
    const a = newRun({ ...emptyDraft(), name: 'A', stepId: 'research', metrics: [{ name: 'acc', value: 1, split: 'test' }] }, T, 'run-aaaaaa');
    const b = newRun({ ...emptyDraft(), name: 'B', metrics: [{ name: 'acc', value: 1, split: 'test' }] }, T, 'run-bbbbbb');
    expect(a.stepId).toBe('research');
    expect('stepId' in b).toBe(false);
    const tampered = cleanRun({ ...a, stepId: 'not_a_step' })!;
    expect(tampered).toBeTruthy();
    expect(tampered.name).toBe('A');
    expect('stepId' in tampered).toBe(false);
    expect(isStepId('evidence')).toBe(true);
    expect(isStepId('Evidence')).toBe(false);
  });
  it('runs saved before steps existed are read unchanged', () => {
    const old = { id: 'run-oldold', source: 'student', step: 'experiments', outcome: 'completed', name: 'Old run', purpose: '', dataset: '', split: '', model: '', settings: '', seeds: '', versions: '', hardware: '', duration: '', metrics: [{ name: 'acc', value: 0.5, split: 'test' }], log: '', notes: '', createdAt: T, updatedAt: T };
    expect(cleanRuns([old])).toEqual([old]);
  });
  it('the AI sees the step title, and English stays the default for old clients', () => {
    const r = newRun({ ...emptyDraft(), stepId: 'research', name: 'A', metrics: [{ name: 'acc', value: 1, split: 'test' }] }, T, 'run-aaaaaa');
    expect(runMessages(r)[1].content).toContain('Reply language: English\nSource: Reported by the student\nStep: Collect data and record results');
    expect(runMessages(r, '', 'fr')[1].content).toContain('Reply language: French');
    expect(runMessages({ ...r, stepId: undefined })[1].content).toContain('Step: not assigned');
  });
  it('a reply that loses its whole summary gets a neutral note in the chosen language, without numbers', () => {
    const r = newRun({ ...emptyDraft(), name: 'A', metrics: [{ name: 'accuracy', value: 0.9, split: 'test' }] }, T, 'run-aaaaaa');
    const fr = normalizeRunFeedback({ summary: 'La précision a progressé de 15 %.' }, r, 'fr');
    expect(fr.summary).toBe(t('fr').neutralSummary);
    expect(fr.summary).not.toMatch(/\d/);
    expect(normalizeRunFeedback({ summary: 'Accuracy rose to 0.97.' }, r).summary).toBe(t('en').neutralSummary);
  });
});

describe('Document research counts', () => {
  it('counts only real checks as verified, never a tick', () => {
    let lab = setMarked(emptyLab(), 'git', true, T);
    lab = { ...lab, os: 'windows' };
    lab = recordCheck(lab, 'python', 'windows', verifyOutput('python', 'Python 3.12.7', W), '2026-11-08T10:00:00.000Z');
    lab = recordCheck(lab, 'pip', 'windows', verifyOutput('pip', 'nonsense', W), T);
    lab = recordCheck(lab, 'numpy', 'windows', verifyOutput('numpy', 'numpy 2.1.3', W), T);
    const runs = [
      newRun({ ...emptyDraft(), name: 'A', stepId: 'experiments', metrics: [{ name: 'acc', value: 1, split: 'test' }] }, T, 'run-aaaaaa'),
      newRun({ ...emptyDraft(), name: 'B', stepId: 'experiments', metrics: [{ name: 'acc', value: 1, split: 'test' }] }, T, 'run-bbbbbb'),
      newRun({ ...emptyDraft(), name: 'C', outcome: 'failed', notes: 'crashed' }, T, 'run-cccccc'),
    ];
    const c = researchCounts({ ...emptyPath(), lab, runs });
    expect(c).toMatchObject({ hasLab: true, verified: 2, pending: 1, attention: 1, latest: T, runs: 3, completed: 2, failed: 1, linked: 2, unassigned: 1, byStep: [{ id: 'experiments', n: 2 }] });
  });
  it('is empty, not zero-alarming, for a thesis without Lab use', () => {
    expect(researchCounts(emptyPath())).toMatchObject({ hasLab: false, runs: 0, verified: 0, byStep: [] });
  });
  it('a thesis with Lab data and runs is still a valid saved copy', () => {
    const p = { ...applySituation(emptyPath(), 'nothing', {}), lab: emptyLab(), runs: [] };
    expect(isPathState(p)).toBe(true);
  });
});
