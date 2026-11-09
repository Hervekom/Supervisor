import type { Page } from '@playwright/test';
import { expect, seed, started, stored, test } from './fixtures';

// Phase B2.1: language, steps for runs, research evidence on the Document page. All data is synthetic.
const T = '2026-11-09T09:00:00.000Z';
const LAB = { workTypes: ['python'], os: 'windows', gpu: 'no', osConfirmed: true, updatedAt: T, tools: { python: { check: { status: 'verified', os: 'windows', rule: 1, at: T, reason: 'ok', found: 'Python 3.12.7' } }, git: { marked: true }, pip: { check: { status: 'failed', os: 'windows', rule: 1, at: T, reason: 'unrelated' } } } };
const run = (id: string, name: string, over: Record<string, unknown> = {}) => ({ id, source: 'student', step: 'experiments', outcome: 'completed', name, purpose: '', dataset: '', split: '', model: '', settings: '', seeds: '', versions: '', hardware: '', duration: '', metrics: [{ name: 'accuracy', value: 0.9, split: 'test' }], log: '', notes: '', createdAt: T, updatedAt: T, ...over });
const thesis = (over = {}) => started({ current: 'experiments', steps: { evidence: { work: 'Existing results notes', checks: [], status: 'open' } }, lab: LAB as never, ...over });
/** Sets the language once, exactly as the app stores it (plain text, not JSON). */
const french = (page: Page) =>
  page.addInitScript(() => {
    if (sessionStorage.getItem('lang-seeded')) return;
    sessionStorage.setItem('lang-seeded', '1');
    localStorage.setItem('lang:v1', 'fr');
  });
const runCard = (page: Page, name: string) => page.getByTestId('run-card').filter({ has: page.getByRole('heading', { name, exact: true }) });

test('English is the default, French is complete, and the choice survives a reload', async ({ page }) => {
  await seed(page, { 'path:v1': thesis() });
  await page.goto('/lab');
  await expect(page.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('1. What does your research involve?')).toBeVisible();
  const before = await stored(page, 'path:v1');

  await page.getByRole('button', { name: 'Français' }).click();
  await expect(page.getByText('1. Que comporte votre recherche ?')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /^Programmation Python/ })).toBeChecked();
  await expect(page.getByTestId('status-python')).toHaveText('Vérifié');
  await expect(page.getByTestId('status-git')).toHaveText('Installation cochée par vous');
  await expect(page.getByTestId('status-pip')).toHaveText('Vérification échouée');
  const py = page.locator('.lab-card').filter({ has: page.getByRole('heading', { name: 'Python', exact: true }) });
  await expect(py.getByText('Le langage dans lequel est écrite la plupart du code de recherche en informatique.', { exact: false })).toBeVisible();
  // Commands are never translated.
  await expect(py.locator('code').filter({ hasText: 'python --version' })).toBeVisible();
  await expect(py.getByRole('button', { name: 'Copier la commande : python --version' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Expériences' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('lang:v1'))).toBe('fr');
  // Choosing a language changes nothing in the thesis.
  expect(await stored(page, 'path:v1')).toEqual(before);

  await page.reload();
  await expect(page.getByRole('button', { name: 'Français' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('2. Quel est le système de votre ordinateur de recherche ?')).toBeVisible();
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByTestId('status-python')).toHaveText('Verified');
  expect(await stored(page, 'path:v1')).toEqual(before);
});

test('a pasted check in French gives French reasons and keeps commands as they are', async ({ page }) => {
  await seed(page, { 'path:v1': thesis() });
  await french(page);
  await page.goto('/lab');
  const git = page.locator('.lab-card').filter({ has: page.getByRole('heading', { name: 'Git', exact: true }) });
  await git.getByLabel('Collez ce que la commande a affiché').fill('je l’ai installé');
  await expect(git.getByTestId('status-git')).toHaveText('Vérification en attente');
  await git.getByRole('button', { name: 'Vérifier le résultat' }).click();
  await expect(git.getByText('Cela ne ressemble pas au résultat de git --version.')).toBeVisible();
  await git.getByLabel('Collez ce que la commande a affiché').fill('git version 2.47.1.windows.1');
  await git.getByRole('button', { name: 'Vérifier le résultat' }).click();
  await expect(git.getByText('Vérification : Vérifié. Git 2.47.1 trouvé sur Windows.')).toBeVisible();
});

test('runs are linked to a step, edited in French without losing their identity, and filtered by step', async ({ page }) => {
  await seed(page, { 'path:v1': thesis({ runs: [run('run-oldold', 'Old run without a step')] }) });
  await french(page);
  await page.goto('/lab');
  await expect(runCard(page, 'Old run without a step').getByText('Aucune étape associée')).toBeVisible();

  await page.getByRole('button', { name: 'Ajouter une expérience' }).click();
  await page.getByLabel('Étape de recherche').selectOption('research');
  await page.getByLabel('Nom de l’expérience').fill('Pilote, graine 1');
  await page.getByRole('button', { name: 'Ajouter un résultat' }).click();
  await page.getByLabel('Nom du résultat 1').fill('accuracy');
  await page.getByLabel('Valeur du résultat 1').fill('0,88');
  await page.getByRole('button', { name: 'Enregistrer l’expérience' }).click();
  const card = runCard(page, 'Pilote, graine 1');
  await expect(card.getByText('Collecter les données et noter les résultats')).toBeVisible();
  await expect(card.getByRole('row', { name: 'accuracy Test 0,88' })).toBeVisible();

  let saved = await stored(page, 'path:v1');
  const created = saved.runs.find((r: { name: string }) => r.name === 'Pilote, graine 1');
  expect(created).toMatchObject({ stepId: 'research', metrics: [{ value: 0.88 }] });

  // Change the step, then clear it.
  await card.getByRole('button', { name: 'Modifier' }).click();
  await page.getByLabel('Étape de recherche').selectOption('experiments');
  await page.getByRole('button', { name: 'Enregistrer l’expérience' }).click();
  await expect(card.getByText('Entraîner vos modèles')).toBeVisible();
  await card.getByRole('button', { name: 'Modifier' }).click();
  await page.getByLabel('Étape de recherche').selectOption('');
  await page.getByRole('button', { name: 'Enregistrer l’expérience' }).click();
  saved = await stored(page, 'path:v1');
  const edited = saved.runs.find((r: { id: string }) => r.id === created.id);
  expect(edited).toMatchObject({ id: created.id, createdAt: created.createdAt, name: 'Pilote, graine 1' });
  expect(edited.stepId).toBeUndefined();
  expect(saved.runs.find((r: { id: string }) => r.id === 'run-oldold')).toMatchObject({ name: 'Old run without a step' });

  // Filter
  await card.getByRole('button', { name: 'Modifier' }).click();
  await page.getByLabel('Étape de recherche').selectOption('research');
  await page.getByRole('button', { name: 'Enregistrer l’expérience' }).click();
  await page.getByLabel('Afficher les expériences de').selectOption('research');
  await expect(page.getByTestId('run-card')).toHaveCount(1);
  await page.getByLabel('Afficher les expériences de').selectOption('none');
  await expect(page.getByTestId('run-card')).toHaveText(/Old run without a step/);
  await page.getByLabel('Afficher les expériences de').selectOption('all');
  await expect(page.getByTestId('run-card')).toHaveCount(2);
});

test('the results sheet gets the step and keeps earlier notes', async ({ page }) => {
  await seed(page, { 'path:v1': thesis({ runs: [run('run-aaaaaa', 'Baseline, seed 1', { stepId: 'experiments' })] }) });
  await page.goto('/lab');
  await runCard(page, 'Baseline, seed 1').getByRole('button', { name: 'Add to my results sheet' }).click();
  const work = (await stored(page, 'path:v1')).steps.evidence.work as string;
  expect(work).toBe('Existing results notes\n\nRun: Baseline, seed 1 (reported by the student, 2026-11-09)\nStep: Train your models\nResults: accuracy (test) = 0.9');
});

test('AI feedback in French is asked in French and loses its unsupported claims', async ({ page }) => {
  await seed(page, { 'path:v1': thesis({ runs: [run('run-aaaaaa', 'Référence', { metrics: [{ name: 'accuracy', value: 0.912, split: 'test' }] })] }) });
  await french(page);
  let body = '';
  page.on('request', (r) => { if (r.url().includes('/api/runs/feedback')) body = r.postData() ?? ''; });
  await page.goto('/lab');
  const card = runCard(page, 'Référence');
  await card.getByRole('button', { name: 'Demander un avis' }).click();
  await expect(card.getByText('Avis simulé. La valeur saisie 0.912 vient d’une seule graine.')).toBeVisible();
  expect(JSON.parse(body).language).toBe('fr');
  await expect(card.getByText(/3 fois plus rapide/)).toHaveCount(0);
  await expect(card.getByText(/15 %/)).toHaveCount(0);
  await expect(card.getByText('Ensuite : Simulé : relancez avec 3 graines.')).toBeVisible();
  await expect(card.getByText(/2 affirmations ont été retirées/)).toBeVisible();
  const log = (await stored(page, 'path:v1')).log as { step: string }[];
  expect(log.at(-1)!.step).toBe('experiments');
});

test('the Document page shows Lab evidence, counted from real checks, and links to the runs of a step', async ({ page }) => {
  await seed(page, { 'path:v1': thesis({ runs: [run('run-aaaaaa', 'A', { stepId: 'experiments' }), run('run-bbbbbb', 'B', { stepId: 'experiments' }), run('run-cccccc', 'C', { outcome: 'failed', metrics: [], notes: 'crashed' })] }) });
  await page.goto('/document');
  const box = page.getByTestId('research-evidence');
  await expect(box.getByRole('heading', { name: 'Research evidence' })).toBeVisible();
  await expect(box.getByText('1 verified')).toBeVisible();
  await expect(box.getByText('1 marked by you, not checked yet')).toBeVisible();
  await expect(box.getByText('1 need attention')).toBeVisible();
  await expect(box.getByText('Latest verification: 2026-11-09.')).toBeVisible();
  await expect(box.getByText('Experiment runs (reported by you)')).toBeVisible();
  for (const line of ['3 recorded', '2 completed', '1 failed or stopped', '2 linked to a step', '1 not assigned']) await expect(box.getByText(line, { exact: true })).toBeVisible();
  // Nothing is written into the thesis.
  expect((await stored(page, 'path:v1')).steps.evidence.work).toBe('Existing results notes');
  await box.getByRole('link', { name: 'Train your models' }).click();
  await expect(page).toHaveURL(/\/lab\?step=experiments#runs$/);
  await expect(page.getByTestId('run-card')).toHaveCount(2);
});

test('the Document page stays neutral for a thesis that does not use the Lab', async ({ page }) => {
  await seed(page, { 'path:v1': started() });
  await page.goto('/document');
  const box = page.getByTestId('research-evidence');
  await expect(box.getByText(/If your research uses code or data analysis/)).toBeVisible();
  await expect(box.getByText(/\b0 /)).toHaveCount(0);
});

test.describe('in French on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('long French labels fit, controls stay reachable, and delete asks first', async ({ page }) => {
    await seed(page, { 'path:v1': thesis({ runs: [run('run-aaaaaa', 'Référence', { stepId: 'experiments' }), run('run-bbbbbb', 'Graine 2', { stepId: 'experiments', metrics: [{ name: 'accuracy', value: 0.92, split: 'test' }] })] }) });
  await french(page);
    await page.goto('/lab');
    await expect(page.getByRole('button', { name: 'Français' })).toBeVisible();
    await expect(page.getByText('L’installation se fait sur un ordinateur', { exact: false })).toBeVisible();
    await page.getByRole('checkbox', { name: /^Apprentissage profond/ }).check();
    await expect(page.getByText('3. Cet ordinateur a-t-il une carte graphique NVIDIA ?')).toBeVisible();
    await expect(page.getByTestId('run-summary')).toBeVisible();
    await page.getByRole('button', { name: 'Ajouter une expérience' }).click();
    const ask = page.getByRole('button', { name: 'Ask Supervisor' });
    await page.getByLabel('Nom de l’expérience').fill('Essai');
    await expect(ask).toBeHidden();
    await page.getByLabel('Étape de recherche').selectOption('research');
    await page.getByRole('button', { name: 'Annuler' }).click();
    const card = runCard(page, 'Référence');
    await card.getByRole('button', { name: 'Supprimer', exact: true }).click();
    await expect(card.getByText('Supprimer cette expérience ? C’est définitif.')).toBeVisible();
    await card.getByRole('button', { name: 'La garder' }).click();
    await expect(card).toBeVisible();
    for (const where of ['/lab', '/document']) {
      await page.goto(where);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    }
  });
});
