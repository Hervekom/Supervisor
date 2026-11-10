// Practical execution tasks (P9). Supervisor prepares a precise task, the student runs it on their own
// computer, then returns evidence. Nothing runs here: Supervisor never executes code, never reaches the
// student's computer and never invents a result. The checks below only read the text the student pasted.
// Stored as an optional field of PathState, so it syncs with the thesis without any database change.

import { findSensitive } from './labVerify';
import type { LabState } from './lab';
import { statusOf } from './lab';
import { redact } from './runs';
import type { Os, WorkType } from './software';

export type Lang2 = { en: string; fr: string };
export type ExecType = 'manual' | 'terminal' | 'python' | 'statistical' | 'simulation' | 'gpu';
/** light: a phone is enough. pc: needs a computer. gpu: needs a computer with an NVIDIA GPU. */
export type Resource = 'light' | 'pc' | 'gpu';
/**
 * verified: the evidence matches what the task expects.
 * reported: the student says it is done; Supervisor cannot check it.
 * incomplete: something the task needs is missing or does not agree.
 * failed: the evidence shows an error.
 * needs_review: the evidence is complete, and the results need a scientific review by the student and supervisor.
 */
export type ReviewStatus = 'verified' | 'reported' | 'incomplete' | 'failed' | 'needs_review';

/** Raise when a check changes, so older reviews are shown as needing a new submission. */
export const EXEC_RULES_VERSION = 1;
export const MAX_TASKS = 30;
/** The most a student may paste for one check. Longer logs: paste the end. */
export const MAX_PASTE = 200_000;
/** What is kept of a long log after it was checked: its start and its end. */
export const KEEP_HEAD = 2500;
export const KEEP_TAIL = 2500;
const LIMITS = { metrics: 2000, config: 2000, files: 1500, errors: 3000, screenshots: 800, count: 12, input: 200 };

export type InputKind = 'file' | 'column' | 'formula' | 'int' | 'list' | 'text';
export type InputField = { id: string; kind: InputKind; required?: boolean; label: Lang2; hint?: Lang2; placeholder?: string };
export type Instr = { text: Lang2; command?: string; code?: { name: string; body: string } };
export type EvidenceKey = 'output' | 'output2' | 'metrics' | 'config' | 'files' | 'errors' | 'screenshots';
export type Count = { id: string; label: Lang2 };

export type Evidence = {
  output: string;
  output2: string;
  metrics: string;
  config: string;
  files: string;
  errors: string;
  screenshots: string;
  counts: Record<string, string>;
  confirmed: string[];
};
export const emptyEvidence = (): Evidence => ({ output: '', output2: '', metrics: '', config: '', files: '', errors: '', screenshots: '', counts: {}, confirmed: [] });

export type Review = {
  status: ReviewStatus;
  /** Reason codes, mapped to text and recovery steps in the interface. Some carry a value after a colon. */
  reasons: string[];
  /** What was read from the evidence, for example rows=8760. Never a path or a name. */
  found: [string, string][];
  /** Metrics read from the output, never typed by Supervisor. */
  metrics: { name: string; value: number }[];
};
export type StoredReview = Review & { at: string; rule: number; trimmed?: boolean; chars?: number };

export type ExecTask = {
  id: string;
  template: string;
  /** The thesis step the task belongs to. */
  stepId: string;
  /** 0 to 8: understand, prerequisites, prepare, verify, inputs, execute, evidence, review, next. */
  stage: number;
  inputs: Record<string, string>;
  evidence: Evidence;
  review?: StoredReview;
  /** The run record created from this task, when the student saved one. */
  runId?: string;
  createdAt: string;
  updatedAt: string;
};
export type ExecutionState = { tasks: ExecTask[] };

export type Ctx = { os: Os | null };
export type Template = {
  id: string;
  type: ExecType;
  resource: Resource;
  /** Thesis steps where this task helps. The first is where it is filed. */
  steps: string[];
  /** Methodologies it fits. */
  work: (WorkType | 'python')[];
  /** Systems it can run on. All three when absent. */
  os?: Os[];
  /** Ecosystem of the instructions, for the preparation stage. */
  env: 'python' | 'r' | 'none';
  title: Lang2;
  objective: Lang2;
  /** Why a computer is needed, shown on phones. */
  why: Lang2;
  /** Catalogue ids needed before starting. */
  tools: string[];
  inputs: InputField[];
  /** What to configure and record before running. */
  config: Lang2;
  execute: (inputs: Record<string, string>, os: Os) => Instr[];
  expected: Lang2;
  evidence: EvidenceKey[];
  counts?: Count[];
  confirmations?: { id: string; label: Lang2 }[];
  criteria: Lang2[];
  risks: { problem: Lang2; fix: Lang2 }[];
  validate: (ev: Evidence, inputs: Record<string, string>, ctx: Ctx) => Review;
};

export const STAGES = ['understand', 'prerequisites', 'prepare', 'verify', 'inputs', 'execute', 'evidence', 'review', 'next'] as const;
export type Stage = (typeof STAGES)[number];

// ---------- Safe inputs ----------

/** Inputs end up inside commands the student copies, so only plain names are accepted. */
const SAFE: Record<InputKind, RegExp> = {
  file: /^(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/){0,3}[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(csv|tsv|txt)$/,
  column: /^[A-Za-z_][A-Za-z0-9_.]{0,59}$/,
  formula: /^[A-Za-z_][A-Za-z0-9_.]{0,59}\s*~\s*[A-Za-z0-9_.+*:() -]{1,150}$/,
  int: /^\d{1,9}$/,
  list: /^[A-Za-z0-9_. -]{1,60}(?:\s*,\s*[A-Za-z0-9_. -]{1,60}){0,19}$/,
  text: /^[^\r\n<>`$|;&]{1,200}$/,
};
export function inputProblem(f: InputField, v: string): 'missing' | 'unsafe' | null {
  const s = (v ?? '').trim();
  if (!s) return f.required ? 'missing' : null;
  return SAFE[f.kind].test(s) ? null : 'unsafe';
}
/** The value placed in a command: the student's own when it is safe, otherwise a clear placeholder. */
const val = (inputs: Record<string, string>, id: string, fallback: string) => {
  const t = FIELD_KIND[id];
  const v = (inputs[id] ?? '').trim();
  return v && (!t || SAFE[t].test(v)) ? v : fallback;
};
// Field kinds by id, so val() can check a value without the template.
const FIELD_KIND: Record<string, InputKind> = { file: 'file', date: 'column', formula: 'formula', target: 'column' };

// ---------- Reading pasted output ----------

const lines = (t: string) => t.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
/** KEY=value lines printed by the provided scripts. The last occurrence wins. */
export function keyValues(text: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const l of lines(text)) {
    const x = l.match(/^([A-Z][A-Z_]{1,30})=(.{0,300})$/);
    if (x) m.set(x[1], x[2].trim());
  }
  return m;
}
/** "METRIC rmse=1.23" lines. */
export function metricLines(text: string): { name: string; value: number }[] {
  const out = new Map<string, number>();
  for (const l of lines(text)) {
    const x = l.match(/^(?:METRIC|RESULT)\s+([A-Za-z][A-Za-z0-9_@.-]{0,40})\s*=\s*([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?)$/i);
    if (x && Number.isFinite(+x[2])) out.set(x[1], +x[2]);
  }
  return [...out].map(([name, value]) => ({ name, value }));
}
/** Metrics the student typed: "rmse = 1.2, mae 0.8" or one per line. */
export function typedMetrics(text: string): { name: string; value: number; raw: string }[] {
  const out: { name: string; value: number; raw: string }[] = [];
  for (const part of text.split(/[\n;]|,(?=\s*[A-Za-z])/)) {
    const x = part.trim().match(/^([A-Za-z][A-Za-z0-9_@.-]{0,40})\s*[:=]?\s*([-+]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[-+]?\d+)?)\s*%?$/i);
    if (x) out.push({ name: x[1], value: +x[2].replace(',', '.'), raw: x[2].replace(',', '.') });
  }
  return out;
}
/** A typed value agrees with the printed one when it is the printed value rounded to the typed decimals. */
export function sameValue(typed: string, printed: number) {
  const dec = (typed.split('.')[1] ?? '').replace(/e.*$/i, '').length;
  const a = Number(typed);
  if (/e/i.test(typed)) return Math.abs(a - printed) <= Math.abs(printed) * 1e-6;
  return Math.abs(a - printed) <= 0.5 * 10 ** -dec + 1e-12;
}

/** Known errors, in the order they are reported. Each gives a reason code with recovery steps. */
export function detectErrors(text: string): string[] {
  const r: string[] = [];
  const add = (c: string) => r.includes(c) || r.push(c);
  const mod = text.match(/No module named '([\w.-]{1,60})'/);
  if (mod) add(`err_module:${mod[1].split('.')[0]}`);
  if (/CUDA out of memory|OutOfMemoryError: CUDA/i.test(text)) add('err_cuda_oom');
  if (/CUDA driver version is insufficient|NVIDIA driver on your system is too old/i.test(text)) add('err_cuda_driver');
  if (/Torch not compiled with CUDA enabled|No CUDA GPUs are available|Found no NVIDIA driver/i.test(text)) add('err_no_cuda');
  if (/compiled using NumPy 1\.x cannot be run in\s+NumPy 2|numpy\.core\.multiarray failed to import|numpy\.dtype size changed/i.test(text)) add('err_numpy_abi');
  if (/No matching distribution found|requires a different Python|Requires-Python|is not a supported wheel on this platform/i.test(text)) add('err_version');
  if (/FileNotFoundError|No such file or directory|cannot open file '|cannot open the connection/i.test(text)) add('err_file');
  if (/PermissionError|Permission denied|Access is denied/i.test(text)) add('err_permission');
  if (/\bMemoryError|Unable to allocate|cannot allocate vector of size/i.test(text)) add('err_memory');
  if (/is not recognized as an internal or external command|command not found/i.test(text)) add('err_command');
  const fn = text.match(/could not find function "([\w.]{1,60})"/);
  if (fn) add(`err_r_function:${fn[1]}`);
  const obj = text.match(/object '([\w.]{1,60})' not found/);
  if (obj) add(`err_r_object:${obj[1]}`);
  if (/there is no package called/i.test(text)) add('err_r_package');
  const key = text.match(/KeyError: '([^'\n]{1,60})'/);
  if (key) add('err_column');
  if (/PatsyError|Error evaluating factor/i.test(text)) add('err_column');
  if (/UnicodeDecodeError/i.test(text)) add('err_encoding');
  if (/ParserError|Error tokenizing data/i.test(text)) add('err_parse');
  if (/SyntaxError|IndentationError/i.test(text)) add('err_syntax');
  if (!r.length && /Traceback \(most recent call last\)|^Error in |^Error: /m.test(text)) add('err_other');
  return r;
}

const review = (status: ReviewStatus, reasons: string[], found: [string, string][] = [], metrics: Review['metrics'] = []): Review => ({ status, reasons, found, metrics });
const num = (s: string | undefined) => (s !== undefined && /^-?\d+$/.test(s) ? Number(s) : NaN);
const errorsIn = (ev: Evidence) => detectErrors(`${ev.output}\n${ev.output2}\n${ev.errors}`);

// ---------- Shared instructions ----------

export function prepareSteps(env: Template['env'], os: Os): Instr[] {
  if (env === 'none') return [{ text: { en: 'Open the software you installed for this task and keep your files in one project folder.', fr: 'Ouvrez le logiciel installé pour cette tâche et gardez vos fichiers dans un même dossier de projet.' } }];
  if (env === 'r')
    return [
      { text: { en: 'Put your data file in a folder named data inside your project folder.', fr: 'Placez votre fichier de données dans un dossier nommé data, dans le dossier de votre projet.' } },
      { text: { en: 'Open RStudio and set the project folder as the working folder: Session, Set Working Directory, Choose Directory. In R without RStudio, use the File menu (Windows: Change dir; macOS: Misc, Change Working Directory).', fr: 'Ouvrez RStudio et choisissez le dossier du projet comme dossier de travail : Session, Set Working Directory, Choose Directory. Dans R sans RStudio, utilisez le menu Fichier (Windows : Changer le répertoire courant ; macOS : Divers, Changer de répertoire de travail).' } },
      { text: { en: 'Check the working folder in the R console. It prints the folder path: you do not need to share it.', fr: 'Vérifiez le dossier de travail dans la console R. Elle affiche le chemin du dossier : inutile de le partager.' }, command: 'getwd()' },
    ];
  return [
    { text: { en: os === 'windows' ? 'Open Command Prompt (not PowerShell) in your project folder: type cmd in the address bar of the folder in File Explorer.' : 'Open a terminal in your project folder.', fr: os === 'windows' ? 'Ouvrez l’Invite de commandes (pas PowerShell) dans le dossier du projet : tapez cmd dans la barre d’adresse du dossier dans l’Explorateur.' : 'Ouvrez un terminal dans le dossier de votre projet.' } },
    { text: { en: 'Activate the project environment. Do this each time you open a new terminal.', fr: 'Activez l’environnement du projet. Faites-le à chaque nouveau terminal.' }, command: os === 'windows' ? '.venv\\Scripts\\activate' : 'source .venv/bin/activate' },
    { text: { en: 'Put your data files in a folder named data inside the project folder.', fr: 'Placez vos fichiers de données dans un dossier nommé data, dans le dossier du projet.' } },
  ];
}

const SAVE_SCRIPT = (name: string): Lang2 => ({
  en: `Create a file named ${name} in your project folder with VS Code or another plain-text editor, and paste this text into it. Read it first: it only reads your data and prints a summary.`,
  fr: `Créez un fichier nommé ${name} dans le dossier du projet avec VS Code ou un autre éditeur de texte brut, et collez-y ce texte. Lisez-le d’abord : il lit seulement vos données et affiche un résumé.`,
});

const DATASET_PY = `# check_dataset.py - prints a short summary of one CSV file. It only reads the file.
import sys
import pandas as pd

path = sys.argv[1]
date_column = sys.argv[2] if len(sys.argv) > 2 else None
data = pd.read_csv(path)
print("ROWS=" + str(len(data)))
print("COLUMNS=" + str(data.shape[1]))
print("NAMES=" + ",".join(str(c) for c in data.columns))
print("MISSING=" + str(int(data.isna().sum().sum())))
print("DUPLICATES=" + str(int(data.duplicated().sum())))
if date_column:
    dates = pd.to_datetime(data[date_column], errors="coerce")
    print("BAD_DATES=" + str(int(dates.isna().sum())))
    print("FIRST=" + str(dates.min()))
    print("LAST=" + str(dates.max()))
print("CHECK=done")
`;

const DATASET_R = (file: string) => `# check_dataset.R - prints a short summary of one CSV file. It only reads the file.
data <- read.csv("${file}")
cat("ROWS=", nrow(data), "\\n", sep = "")
cat("COLUMNS=", ncol(data), "\\n", sep = "")
cat("NAMES=", paste(names(data), collapse = ","), "\\n", sep = "")
cat("MISSING=", sum(is.na(data)), "\\n", sep = "")
cat("DUPLICATES=", sum(duplicated(data)), "\\n", sep = "")
cat("CHECK=done\\n")
`;

const REPORT_PY = `# Add these lines at the end of your own training or evaluation script.
# seed, device and metrics are the names your script already uses: adapt them.
print("SEED=" + str(seed))
print("DEVICE=" + str(device))
for name, value in metrics.items():
    print("METRIC " + name + "=" + str(value))
`;

const GPU_PY = `python -c "import torch; print('torch', torch.__version__, 'cuda', torch.cuda.is_available()); print('GPU=' + (torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'none'))"`;

const REG_R = (file: string, formula: string) => `# regression.R - fits one linear regression and prints the full summary.
data <- read.csv("${file}")
model <- lm(${formula}, data = data)
print(summary(model))
cat("ROWS=", nrow(data), "\\n", sep = "")
cat("NOBS=", nobs(model), "\\n", sep = "")
cat("R_VERSION=", R.version.string, "\\n", sep = "")
`;

const REG_PY = (file: string, formula: string) => `# regression.py - fits one linear regression and prints the full summary.
import pandas as pd
import statsmodels
import statsmodels.formula.api as smf

data = pd.read_csv("${file}")
model = smf.ols("${formula}", data=data).fit()
print(model.summary())
print("ROWS=" + str(len(data)))
print("NOBS=" + str(int(model.nobs)))
print("STATSMODELS=" + statsmodels.__version__)
`;

const SIM_PY = `# Add these lines to your own simulation script.
# seed is the random seed your script uses; results holds the numbers it produces.
print("SEED=" + str(seed))
print("STEPS=" + str(steps))
for name, value in results.items():
    print("RESULT " + name + "=" + str(value))
`;

const FILE_INPUT: InputField = { id: 'file', kind: 'file', required: true, label: { en: 'Data file, inside your project folder', fr: 'Fichier de données, dans le dossier du projet' }, hint: { en: 'For example data/solar_hourly.csv. Letters, numbers, - _ . and / only.', fr: 'Par exemple data/solar_hourly.csv. Lettres, chiffres, - _ . et / uniquement.' }, placeholder: 'data/my_data.csv' };

// ---------- Validation of each kind of evidence ----------

function datasetReview(ev: Evidence, inputs: Record<string, string>): Review {
  const errs = errorsIn(ev);
  const kv = keyValues(ev.output);
  if (errs.length && !kv.has('CHECK')) return review('failed', errs);
  if (!ev.output.trim()) return review('incomplete', ['no_output']);
  const rows = num(kv.get('ROWS'));
  const cols = num(kv.get('COLUMNS'));
  if (!kv.has('CHECK') || Number.isNaN(rows) || Number.isNaN(cols)) return review('incomplete', ['not_task_output']);
  const found: [string, string][] = [['rows', String(rows)], ['columns', String(cols)]];
  const reasons: string[] = [];
  if (rows === 0) return review('failed', ['empty_dataset'], found);
  const missing = num(kv.get('MISSING'));
  const dups = num(kv.get('DUPLICATES'));
  if (!Number.isNaN(missing)) found.push(['missing values', String(missing)]);
  if (!Number.isNaN(dups)) found.push(['duplicate rows', String(dups)]);
  const expRows = num((inputs.rows ?? '').trim());
  if (!Number.isNaN(expRows) && expRows !== rows) reasons.push(`rows_differ:${expRows}`);
  const names = (kv.get('NAMES') ?? '').split(',').map((s) => s.trim());
  const wanted = (inputs.columns ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const absent = wanted.filter((c) => !names.includes(c));
  if (absent.length) reasons.push(`columns_missing:${absent.slice(0, 5).join(', ')}`);
  if (inputs.date?.trim() && !kv.has('BAD_DATES')) reasons.push('no_date_check');
  const bad = num(kv.get('BAD_DATES'));
  if (!Number.isNaN(bad)) {
    found.push(['unreadable dates', String(bad)]);
    if (kv.get('FIRST') && kv.get('FIRST') !== 'NaT') found.push(['first date', kv.get('FIRST')!.slice(0, 25)]);
    if (kv.get('LAST') && kv.get('LAST') !== 'NaT') found.push(['last date', kv.get('LAST')!.slice(0, 25)]);
  }
  if (reasons.length) return review('incomplete', reasons, found);
  // The file was read as expected. Quality issues are for the student and supervisor to judge.
  const notes: string[] = [];
  if (!Number.isNaN(missing) && missing > 0) notes.push('missing_values');
  if (!Number.isNaN(dups) && dups > 0) notes.push('duplicates');
  if (!Number.isNaN(bad) && bad > 0) notes.push('bad_dates');
  return notes.length ? review('needs_review', notes, found) : review('verified', ['dataset_ok'], found);
}

function experimentReview(ev: Evidence, inputs: Record<string, string>, gpu: boolean): Review {
  const errs = errorsIn(ev);
  const printed = metricLines(ev.output);
  const kv = keyValues(ev.output);
  if (errs.length && !printed.length) return review('failed', errs);
  if (!ev.output.trim()) return review('incomplete', ['no_output']);
  const found: [string, string][] = [];
  const reasons: string[] = [];
  if (kv.has('SEED')) found.push(['seed', kv.get('SEED')!.slice(0, 40)]);
  else reasons.push('no_seed');
  const device = (kv.get('DEVICE') ?? '').toLowerCase();
  if (device) found.push(['device', device.slice(0, 30)]);
  else reasons.push('no_device');
  if (gpu && device && !device.startsWith('cuda')) return review('failed', ['not_on_gpu'], found, printed);
  if (!printed.length) reasons.push('no_metrics');
  const wanted = (inputs.metrics ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const have = new Set(printed.map((m) => m.name.toLowerCase()));
  const absent = wanted.filter((w) => !have.has(w));
  if (absent.length) reasons.push(`metrics_missing:${absent.slice(0, 5).join(', ')}`);
  for (const t of typedMetrics(ev.metrics)) {
    const p = printed.find((m) => m.name.toLowerCase() === t.name.toLowerCase());
    if (!p) reasons.push(`metric_not_in_log:${t.name}`);
    else if (!sameValue(t.raw, p.value)) reasons.push(`metric_mismatch:${t.name}`);
  }
  if (!ev.config.trim()) reasons.push('no_config');
  if (errs.length) reasons.push(...errs.map((e) => `also_${e}`));
  if (reasons.length) return review('incomplete', reasons, found, printed);
  // The run is documented. Whether the numbers are good, fair and meaningful is a scientific judgement.
  return review('needs_review', ['run_documented'], found, printed);
}

/** Reads the R summary(lm) or statsmodels OLS summary the scripts print. */
function regressionReview(ev: Evidence, lang: 'r' | 'python'): Review {
  const errs = errorsIn(ev);
  const out = ev.output;
  if (!out.trim()) return review(errs.length ? 'failed' : 'incomplete', errs.length ? errs : ['no_output']);
  const ok = lang === 'r' ? /Coefficients:/.test(out) && /Residual standard error:/.test(out) : /OLS Regression Results/.test(out) && /No\. Observations:/.test(out);
  if (!ok) return review(errs.length ? 'failed' : 'incomplete', errs.length ? errs : ['not_task_output']);
  const kv = keyValues(out);
  const found: [string, string][] = [];
  const rows = num(kv.get('ROWS'));
  const nobsLine = lang === 'r' ? out.match(/on (\d+) degrees of freedom/) : out.match(/No\. Observations:\s+(\d+)/);
  const nobs = Number.isNaN(num(kv.get('NOBS'))) ? (nobsLine && lang === 'python' ? +nobsLine[1] : NaN) : num(kv.get('NOBS'));
  const r2 = lang === 'r' ? out.match(/Multiple R-squared:\s+([\d.]+)/) : out.match(/\bR-squared:\s+([\d.]+)/);
  if (!Number.isNaN(rows)) found.push(['rows in file', String(rows)]);
  if (!Number.isNaN(nobs)) found.push(['observations used', String(nobs)]);
  if (lang === 'r' && nobsLine) found.push(['residual degrees of freedom', nobsLine[1]]);
  if (r2) found.push(['R-squared', r2[1]]);
  const v = kv.get(lang === 'r' ? 'R_VERSION' : 'STATSMODELS');
  if (v) found.push([lang === 'r' ? 'R' : 'statsmodels', v.replace(/^R version /, '').slice(0, 40)]);
  const reasons: string[] = [];
  if (Number.isNaN(nobs)) reasons.push('no_nobs');
  if (reasons.length) return review('incomplete', reasons, found);
  const notes = ['model_fitted'];
  if (!Number.isNaN(rows) && nobs < rows) notes.push(`rows_dropped:${rows - nobs}`);
  return review('needs_review', notes, found);
}

function simulationReview(ev: Evidence): Review {
  const errs = errorsIn(ev);
  const a = metricLines(ev.output);
  const b = metricLines(ev.output2);
  if (errs.length && !a.length) return review('failed', errs);
  if (!ev.output.trim()) return review('incomplete', ['no_output']);
  const ka = keyValues(ev.output);
  const kb = keyValues(ev.output2);
  const found: [string, string][] = [];
  if (ka.has('SEED')) found.push(['seed', ka.get('SEED')!.slice(0, 40)]);
  if (ka.has('STEPS')) found.push(['steps', ka.get('STEPS')!.slice(0, 40)]);
  const reasons: string[] = [];
  if (!ka.has('SEED')) reasons.push('no_seed');
  if (!a.length) reasons.push('no_results');
  if (!ev.output2.trim()) reasons.push('no_second_run');
  if (reasons.length) return review('incomplete', reasons, found, a);
  if (kb.get('SEED') !== ka.get('SEED')) return review('incomplete', ['seed_changed'], found, a);
  const differ = a.filter((x) => { const y = b.find((m) => m.name === x.name); return !y || y.value !== x.value; });
  if (differ.length || b.length !== a.length) return review('failed', [`not_reproducible:${differ.map((d) => d.name).slice(0, 5).join(', ') || 'results'}`], found, a);
  return review('verified', ['reproducible'], found, a);
}

function freezeReview(ev: Evidence, inputs: Record<string, string>): Review {
  const errs = errorsIn(ev);
  const ls = lines(ev.output);
  const pkgs = ls.map((l) => l.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:==\s*([^\s;]+)|@\s)/)).filter((x): x is RegExpMatchArray => !!x);
  if (!ls.length) return review('incomplete', ['no_output']);
  if (errs.length && !pkgs.length) return review('failed', errs);
  if (pkgs.length < ls.length * 0.8) return review('incomplete', ['not_task_output']);
  const norm = (s: string) => s.toLowerCase().replace(/[-_.]+/g, '-');
  const have = new Map(pkgs.map((m) => [norm(m[1]), m[2] ?? 'local']));
  const want = (inputs.packages ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const found: [string, string][] = [['packages listed', String(pkgs.length)]];
  for (const w of want) if (have.has(norm(w))) found.push([w, have.get(norm(w))!]);
  const absent = want.filter((w) => !have.has(norm(w)));
  if (absent.length) return review('incomplete', [`packages_missing:${absent.slice(0, 6).join(', ')}`], found);
  return review('verified', ['environment_recorded'], found);
}

function gpuReview(ev: Evidence): Review {
  const out = ev.output;
  const errs = errorsIn(ev);
  if (!out.trim()) return review('incomplete', ['no_output']);
  const smi = out.match(/NVIDIA-SMI\s+[\d.]+\s+Driver Version:\s*([\d.]+)(?:\s+CUDA Version:\s*([\d.]+))?/);
  const torch = out.match(/^torch (\S+) cuda (True|False)$/m);
  const found: [string, string][] = [];
  if (smi) found.push(['NVIDIA driver', smi[1]], ...(smi[2] ? [['driver supports CUDA up to', smi[2]] as [string, string]] : []));
  if (torch) found.push(['PyTorch', torch[1]], ['CUDA available', torch[2]]);
  const name = out.match(/^GPU=(.{1,80})$/m);
  if (name && name[1] !== 'none') found.push(['GPU', name[1].trim()]);
  if (/couldn't communicate with the NVIDIA driver/i.test(out)) return review('failed', ['nvidia_no_driver'], found);
  if (!smi && !torch) return review(errs.length ? 'failed' : 'incomplete', errs.length ? errs : ['not_task_output'], found);
  if (!smi) return review('incomplete', ['no_smi'], found);
  if (!torch) return review(errs.length ? 'failed' : 'incomplete', errs.length ? errs : ['no_torch_line'], found);
  if (torch[2] !== 'True') return review('failed', [/\+cpu\b/.test(torch[1]) ? 'torch_cpu_build' : 'torch_no_cuda'], found);
  return review('verified', ['gpu_ready'], found);
}

function qualitativeReview(ev: Evidence, counts: Count[], confirmations: { id: string }[]): Review {
  const found: [string, string][] = [];
  const reasons: string[] = [];
  for (const c of counts) {
    const v = (ev.counts[c.id] ?? '').trim();
    if (!/^\d{1,6}$/.test(v)) reasons.push(`count_missing:${c.id}`);
    else found.push([c.id, v]);
  }
  if (!ev.files.trim()) reasons.push('no_files');
  const notConfirmed = confirmations.filter((c) => !ev.confirmed.includes(c.id));
  for (const c of notConfirmed) reasons.push(`not_confirmed:${c.id}`);
  const n = (id: string) => Number(ev.counts[id] ?? NaN);
  if (n('codes') === 0 || n('documents') === 0) reasons.push('zero_count');
  if (n('highlights') < n('codes')) reasons.push('codes_unused');
  if (reasons.length) return review('incomplete', reasons, found);
  // Coding is interpretive work. Supervisor can see that it is documented, never that it is right.
  return review('reported', ['coding_documented'], found);
}

// ---------- The tasks ----------

const PY = ['python', 'statistics', 'data_science', 'machine_learning', 'deep_learning', 'computer_vision', 'nlp', 'simulation'] as const;
const ML = ['machine_learning', 'deep_learning', 'computer_vision', 'nlp', 'data_science'] as const;
const DL = ['deep_learning', 'computer_vision', 'nlp'] as const;

const common = {
  traceback: { problem: { en: 'The output ends with Traceback or Error', fr: 'La sortie se termine par Traceback ou Error' }, fix: { en: 'Paste it anyway in the evidence: Supervisor reads the error and explains the next step. Nothing is lost.', fr: 'Collez-la quand même dans les preuves : Supervisor lit l’erreur et explique l’étape suivante. Rien n’est perdu.' } },
  venv: { problem: { en: 'ModuleNotFoundError', fr: 'ModuleNotFoundError' }, fix: { en: 'The project environment is not active, or the package is not installed in it. Activate .venv, then install it with python -m pip install.', fr: 'L’environnement du projet n’est pas actif, ou le paquet n’y est pas installé. Activez .venv, puis installez-le avec python -m pip install.' } },
};

export const TEMPLATES: Template[] = [
  {
    id: 'dataset-check',
    type: 'python',
    resource: 'pc',
    steps: ['research', 'experiments', 'method'],
    work: [...PY],
    env: 'python',
    title: { en: 'Check your dataset before using it', fr: 'Vérifier votre jeu de données avant de l’utiliser' },
    objective: { en: 'Confirm that your data file opens, has the rows and columns you expect, and see how many values are missing, before any analysis or training.', fr: 'Confirmer que votre fichier s’ouvre, qu’il a les lignes et colonnes attendues, et voir combien de valeurs manquent, avant toute analyse ou tout entraînement.' },
    why: { en: 'Your dataset stays on your computer. Reading a full data file needs a computer, and it is never uploaded to Supervisor.', fr: 'Votre jeu de données reste sur votre ordinateur. Lire un fichier complet demande un ordinateur, et il n’est jamais envoyé à Supervisor.' },
    tools: ['python', 'venv', 'pandas'],
    inputs: [
      FILE_INPUT,
      { id: 'rows', kind: 'int', label: { en: 'Number of rows you expect (optional)', fr: 'Nombre de lignes attendu (facultatif)' }, hint: { en: 'From the data source or your notes. Leave empty if you do not know.', fr: 'D’après la source des données ou vos notes. Laissez vide si vous ne savez pas.' } },
      { id: 'columns', kind: 'list', label: { en: 'Columns you need (optional)', fr: 'Colonnes nécessaires (facultatif)' }, hint: { en: 'Separated by commas, for example timestamp, ghi, temperature.', fr: 'Séparées par des virgules, par exemple timestamp, ghi, temperature.' } },
      { id: 'date', kind: 'column', label: { en: 'Date or time column (optional)', fr: 'Colonne de date ou d’heure (facultatif)' }, placeholder: 'timestamp' },
    ],
    config: { en: 'Nothing to configure. Note where the data came from and its version or download date in your research log.', fr: 'Rien à configurer. Notez d’où viennent les données et leur version ou date de téléchargement dans votre journal.' },
    execute: (inp) => [
      { text: SAVE_SCRIPT('check_dataset.py'), code: { name: 'check_dataset.py', body: DATASET_PY } },
      { text: { en: 'Run it on your file. Copy everything it prints.', fr: 'Lancez-le sur votre fichier. Copiez tout ce qu’il affiche.' }, command: `python check_dataset.py ${val(inp, 'file', 'data/my_data.csv')}${(inp.date ?? '').trim() && SAFE.column.test(inp.date.trim()) ? ` ${inp.date.trim()}` : ''}` },
    ],
    expected: { en: 'Lines starting with ROWS=, COLUMNS=, NAMES=, MISSING=, DUPLICATES= (and BAD_DATES=, FIRST=, LAST= with a date column), ending with CHECK=done.', fr: 'Des lignes commençant par ROWS=, COLUMNS=, NAMES=, MISSING=, DUPLICATES= (et BAD_DATES=, FIRST=, LAST= avec une colonne de date), puis CHECK=done.' },
    evidence: ['output', 'errors'],
    criteria: [
      { en: 'The script ran to the end (CHECK=done).', fr: 'Le script est allé jusqu’au bout (CHECK=done).' },
      { en: 'The number of rows matches what you expect, when you gave one.', fr: 'Le nombre de lignes correspond à celui attendu, si vous l’avez indiqué.' },
      { en: 'Every column you need is present.', fr: 'Toutes les colonnes nécessaires sont présentes.' },
      { en: 'Missing values, duplicates and unreadable dates are reported, for you to decide what to do.', fr: 'Les valeurs manquantes, doublons et dates illisibles sont signalés, pour que vous décidiez quoi faire.' },
    ],
    risks: [
      { problem: { en: 'FileNotFoundError', fr: 'FileNotFoundError' }, fix: { en: 'The path is relative to the folder where the terminal is open. Check that the file is in data/ and the name is exact.', fr: 'Le chemin part du dossier où le terminal est ouvert. Vérifiez que le fichier est dans data/ et que le nom est exact.' } },
      { problem: { en: 'UnicodeDecodeError or ParserError', fr: 'UnicodeDecodeError ou ParserError' }, fix: { en: 'The file may use another encoding or separator, such as ; in some countries. Open it in a text editor to see.', fr: 'Le fichier utilise peut-être un autre encodage ou séparateur, comme ; dans certains pays. Ouvrez-le dans un éditeur de texte pour voir.' } },
      common.venv,
    ],
    validate: (ev, inp) => datasetReview(ev, inp),
  },
  {
    id: 'dataset-check-r',
    type: 'statistical',
    resource: 'pc',
    steps: ['research', 'method'],
    work: ['statistics_r'],
    env: 'r',
    title: { en: 'Check your dataset in R before using it', fr: 'Vérifier votre jeu de données dans R avant de l’utiliser' },
    objective: { en: 'Confirm in R that your data file opens and has the rows and columns you expect, and see how many values are missing.', fr: 'Confirmer dans R que votre fichier s’ouvre et a les lignes et colonnes attendues, et voir combien de valeurs manquent.' },
    why: { en: 'R runs on your computer and your data stays there. Nothing is uploaded to Supervisor.', fr: 'R fonctionne sur votre ordinateur et vos données y restent. Rien n’est envoyé à Supervisor.' },
    tools: ['r'],
    inputs: [FILE_INPUT, { id: 'rows', kind: 'int', label: { en: 'Number of rows you expect (optional)', fr: 'Nombre de lignes attendu (facultatif)' } }, { id: 'columns', kind: 'list', label: { en: 'Columns you need (optional)', fr: 'Colonnes nécessaires (facultatif)' }, hint: { en: 'Separated by commas.', fr: 'Séparées par des virgules.' } }],
    config: { en: 'Nothing to configure. Note the data source and its version in your research log.', fr: 'Rien à configurer. Notez la source des données et leur version dans votre journal.' },
    execute: (inp) => [
      { text: SAVE_SCRIPT('check_dataset.R'), code: { name: 'check_dataset.R', body: DATASET_R(val(inp, 'file', 'data/my_data.csv')) } },
      { text: { en: 'In the R console, run the script. Copy everything it prints.', fr: 'Dans la console R, lancez le script. Copiez tout ce qu’il affiche.' }, command: 'source("check_dataset.R")' },
    ],
    expected: { en: 'Lines starting with ROWS=, COLUMNS=, NAMES=, MISSING=, DUPLICATES=, ending with CHECK=done.', fr: 'Des lignes commençant par ROWS=, COLUMNS=, NAMES=, MISSING=, DUPLICATES=, puis CHECK=done.' },
    evidence: ['output', 'errors'],
    criteria: [{ en: 'The script ran to the end (CHECK=done).', fr: 'Le script est allé jusqu’au bout (CHECK=done).' }, { en: 'Rows and columns match what you expect.', fr: 'Lignes et colonnes correspondent à l’attendu.' }],
    risks: [
      { problem: { en: 'cannot open file', fr: 'cannot open file' }, fix: { en: 'R looks for the file from the working folder. Run getwd() and set the project folder as working folder.', fr: 'R cherche le fichier à partir du dossier de travail. Lancez getwd() et choisissez le dossier du projet.' } },
      { problem: { en: 'Values are all in one column', fr: 'Toutes les valeurs sont dans une seule colonne' }, fix: { en: 'The file probably uses ; as separator. Use read.csv2 instead of read.csv in the script.', fr: 'Le fichier utilise sans doute ; comme séparateur. Utilisez read.csv2 au lieu de read.csv dans le script.' } },
    ],
    validate: (ev, inp) => datasetReview(ev, inp),
  },
  {
    id: 'experiment',
    type: 'python',
    resource: 'pc',
    steps: ['experiments', 'research'],
    work: [...ML],
    env: 'python',
    title: { en: 'Run one experiment and document it', fr: 'Lancer une expérience et la documenter' },
    objective: { en: 'Run one training or evaluation of your model with a fixed configuration and seed, and keep the metrics it prints, so the run can be reproduced and reported.', fr: 'Lancer un entraînement ou une évaluation de votre modèle avec une configuration et une graine fixées, et garder les métriques affichées, pour que l’expérience soit reproductible et rapportée.' },
    why: { en: 'Training uses your computer’s processor and memory for minutes or hours. A phone cannot do it, and Supervisor never runs your code.', fr: 'L’entraînement utilise le processeur et la mémoire de votre ordinateur pendant des minutes ou des heures. Un téléphone ne peut pas le faire, et Supervisor ne lance jamais votre code.' },
    tools: ['python', 'venv', 'numpy', 'pandas'],
    inputs: [
      { id: 'script', kind: 'text', required: true, label: { en: 'Your script or notebook', fr: 'Votre script ou carnet' }, placeholder: 'train.py' },
      { id: 'metrics', kind: 'list', required: true, label: { en: 'Metrics the run must report', fr: 'Métriques que l’expérience doit donner' }, hint: { en: 'The ones in your method chapter, for example rmse, mae.', fr: 'Celles de votre chapitre de méthode, par exemple rmse, mae.' } },
      { id: 'baseline', kind: 'text', label: { en: 'What it is compared with (optional)', fr: 'Avec quoi elle est comparée (facultatif)' }, placeholder: 'persistence baseline' },
    ],
    config: { en: 'Put every setting in one configuration file (for example config.yaml): data split, model settings, number of epochs, seed. Keep this file with the results.', fr: 'Mettez tous les réglages dans un seul fichier de configuration (par exemple config.yaml) : découpage des données, réglages du modèle, nombre d’époques, graine. Gardez ce fichier avec les résultats.' },
    execute: (inp) => [
      { text: { en: 'Fix the random seed at the start of your script, so the run can be repeated.', fr: 'Fixez la graine aléatoire au début du script, pour pouvoir refaire l’expérience.' } },
      { text: { en: 'At the end of your script, print the seed, the device and each metric in this exact form, so Supervisor can read them.', fr: 'À la fin du script, affichez la graine, le matériel et chaque métrique sous cette forme exacte, pour que Supervisor puisse les lire.' }, code: { name: 'add to your script', body: REPORT_PY } },
      { text: { en: 'Run your script and keep the terminal output.', fr: 'Lancez votre script et gardez la sortie du terminal.' }, command: `python ${/^[A-Za-z0-9_./-]+\.py$/.test((inp.script ?? '').trim()) ? inp.script.trim() : 'train.py'}` },
    ],
    expected: { en: 'The usual output of your script, ending with SEED=, DEVICE= and one METRIC line per metric, for example METRIC rmse=0.1234.', fr: 'La sortie habituelle du script, terminée par SEED=, DEVICE= et une ligne METRIC par métrique, par exemple METRIC rmse=0.1234.' },
    evidence: ['output', 'metrics', 'config', 'files', 'errors', 'screenshots'],
    criteria: [
      { en: 'The seed and device are printed.', fr: 'La graine et le matériel sont affichés.' },
      { en: 'Every metric you named is printed as a number.', fr: 'Chaque métrique nommée est affichée comme un nombre.' },
      { en: 'The metrics you typed agree with the ones printed.', fr: 'Les métriques que vous avez tapées correspondent à celles affichées.' },
      { en: 'The configuration is recorded.', fr: 'La configuration est notée.' },
      { en: 'Whether the results are good is a scientific judgement for you and your supervisor.', fr: 'Juger si les résultats sont bons revient à vous et à votre encadrant.' },
    ],
    risks: [common.venv, common.traceback, { problem: { en: 'MemoryError or the computer freezes', fr: 'MemoryError ou l’ordinateur se bloque' }, fix: { en: 'Use a smaller batch size or a sample of the data first, then scale up.', fr: 'Utilisez un plus petit lot ou un échantillon des données d’abord, puis augmentez.' } }],
    validate: (ev, inp) => experimentReview(ev, inp, false),
  },
  {
    id: 'gpu-check',
    type: 'gpu',
    resource: 'gpu',
    steps: ['experiments', 'method'],
    work: [...DL],
    os: ['windows', 'linux'],
    env: 'python',
    title: { en: 'Check that PyTorch can use your NVIDIA GPU', fr: 'Vérifier que PyTorch peut utiliser votre GPU NVIDIA' },
    objective: { en: 'Confirm that the NVIDIA driver works and that your PyTorch build can see the GPU, before starting a long GPU training.', fr: 'Confirmer que le pilote NVIDIA fonctionne et que votre PyTorch voit le GPU, avant un long entraînement sur GPU.' },
    why: { en: 'Only the computer with the NVIDIA card can answer this. Supervisor does not rent or provide GPUs.', fr: 'Seul l’ordinateur équipé de la carte NVIDIA peut répondre. Supervisor ne loue ni ne fournit de GPU.' },
    tools: ['python', 'venv', 'nvidia-gpu', 'pytorch'],
    inputs: [],
    config: { en: 'If you install PyTorch again, choose the CUDA build on the official PyTorch selector, not the CPU build.', fr: 'Si vous réinstallez PyTorch, choisissez la version CUDA dans le sélecteur officiel de PyTorch, pas la version CPU.' },
    execute: () => [
      { text: { en: 'Check the driver. Copy the top part of the table it prints.', fr: 'Vérifiez le pilote. Copiez le haut du tableau affiché.' }, command: 'nvidia-smi' },
      { text: { en: 'With .venv active, check PyTorch. Copy the two lines it prints.', fr: 'Avec .venv actif, vérifiez PyTorch. Copiez les deux lignes affichées.' }, command: GPU_PY },
    ],
    expected: { en: 'A table with NVIDIA-SMI and Driver Version, then torch <version> cuda True and GPU=<your card>.', fr: 'Un tableau avec NVIDIA-SMI et Driver Version, puis torch <version> cuda True et GPU=<votre carte>.' },
    evidence: ['output', 'errors'],
    criteria: [{ en: 'nvidia-smi shows a driver version.', fr: 'nvidia-smi affiche une version de pilote.' }, { en: 'PyTorch prints cuda True.', fr: 'PyTorch affiche cuda True.' }],
    risks: [
      { problem: { en: 'cuda False', fr: 'cuda False' }, fix: { en: 'PyTorch was installed without CUDA (a version ending with +cpu), or the driver is too old. Reinstall from the official selector with a CUDA version your driver supports.', fr: 'PyTorch a été installé sans CUDA (version finissant par +cpu), ou le pilote est trop ancien. Réinstallez depuis le sélecteur officiel avec une version CUDA prise en charge par votre pilote.' } },
      { problem: { en: 'nvidia-smi is not recognized', fr: 'nvidia-smi n’est pas reconnu' }, fix: { en: 'The NVIDIA driver is not installed, or the computer has no NVIDIA card. Follow the NVIDIA GPU card in your setup.', fr: 'Le pilote NVIDIA n’est pas installé, ou l’ordinateur n’a pas de carte NVIDIA. Suivez la fiche GPU NVIDIA de votre installation.' } },
    ],
    validate: (ev) => gpuReview(ev),
  },
  {
    id: 'gpu-experiment',
    type: 'gpu',
    resource: 'gpu',
    steps: ['experiments'],
    work: [...DL],
    os: ['windows', 'linux'],
    env: 'python',
    title: { en: 'Run one GPU training and document it', fr: 'Lancer un entraînement sur GPU et le documenter' },
    objective: { en: 'Train your model on the NVIDIA GPU with a fixed configuration and seed, and keep the metrics it prints.', fr: 'Entraîner votre modèle sur le GPU NVIDIA avec une configuration et une graine fixées, et garder les métriques affichées.' },
    why: { en: 'Deep learning training needs the GPU of your computer, often for hours. A phone cannot do it, and Supervisor never runs your code.', fr: 'L’entraînement profond demande le GPU de votre ordinateur, souvent pendant des heures. Un téléphone ne peut pas le faire, et Supervisor ne lance jamais votre code.' },
    tools: ['python', 'venv', 'nvidia-gpu', 'pytorch'],
    inputs: [
      { id: 'script', kind: 'text', required: true, label: { en: 'Your training script', fr: 'Votre script d’entraînement' }, placeholder: 'train.py' },
      { id: 'metrics', kind: 'list', required: true, label: { en: 'Metrics the run must report', fr: 'Métriques que l’expérience doit donner' }, hint: { en: 'For example rmse, mae.', fr: 'Par exemple rmse, mae.' } },
    ],
    config: { en: 'Record batch size, epochs, learning rate and seed in your configuration file. Do the GPU check task first.', fr: 'Notez la taille de lot, les époques, le taux d’apprentissage et la graine dans le fichier de configuration. Faites d’abord la tâche de vérification du GPU.' },
    execute: (inp) => [
      { text: { en: 'In your script, send the model and data to the GPU (device = "cuda") and fix the seed.', fr: 'Dans le script, envoyez le modèle et les données sur le GPU (device = "cuda") et fixez la graine.' } },
      { text: { en: 'At the end, print the seed, the device and each metric in this form.', fr: 'À la fin, affichez la graine, le matériel et chaque métrique sous cette forme.' }, code: { name: 'add to your script', body: REPORT_PY } },
      { text: { en: 'Run the training and keep the output.', fr: 'Lancez l’entraînement et gardez la sortie.' }, command: `python ${/^[A-Za-z0-9_./-]+\.py$/.test((inp.script ?? '').trim()) ? inp.script.trim() : 'train.py'}` },
    ],
    expected: { en: 'Your training output, ending with SEED=, DEVICE=cuda and one METRIC line per metric.', fr: 'La sortie de l’entraînement, terminée par SEED=, DEVICE=cuda et une ligne METRIC par métrique.' },
    evidence: ['output', 'metrics', 'config', 'files', 'errors', 'screenshots'],
    criteria: [{ en: 'The device printed is cuda.', fr: 'Le matériel affiché est cuda.' }, { en: 'The seed and every metric are printed.', fr: 'La graine et chaque métrique sont affichées.' }, { en: 'The configuration is recorded.', fr: 'La configuration est notée.' }],
    risks: [
      { problem: { en: 'CUDA out of memory', fr: 'CUDA out of memory' }, fix: { en: 'Halve the batch size, or use a smaller model or shorter sequences, then run again.', fr: 'Divisez la taille de lot par deux, ou utilisez un modèle plus petit ou des séquences plus courtes, puis relancez.' } },
      common.traceback,
    ],
    validate: (ev, inp) => experimentReview(ev, inp, true),
  },
  {
    id: 'regression-python',
    type: 'statistical',
    resource: 'pc',
    steps: ['research', 'evidence'],
    work: ['statistics'],
    env: 'python',
    title: { en: 'Fit your regression model with statsmodels', fr: 'Estimer votre modèle de régression avec statsmodels' },
    objective: { en: 'Fit the regression written in your method chapter on your data, and keep the full result table.', fr: 'Estimer la régression décrite dans votre chapitre de méthode sur vos données, et garder le tableau complet des résultats.' },
    why: { en: 'The model runs on your computer with your full dataset, which stays there.', fr: 'Le modèle s’exécute sur votre ordinateur avec tout votre jeu de données, qui y reste.' },
    tools: ['python', 'venv', 'pandas', 'statsmodels'],
    inputs: [FILE_INPUT, { id: 'formula', kind: 'formula', required: true, label: { en: 'Model formula', fr: 'Formule du modèle' }, hint: { en: 'Outcome ~ predictors, with your column names, for example wage ~ education + experience.', fr: 'Variable expliquée ~ variables explicatives, avec vos noms de colonnes, par exemple wage ~ education + experience.' }, placeholder: 'y ~ x1 + x2' }],
    config: { en: 'Write down why each variable is in the model, from your hypotheses. Decide how missing values are handled before you look at the results.', fr: 'Notez pourquoi chaque variable est dans le modèle, d’après vos hypothèses. Décidez comment traiter les valeurs manquantes avant de regarder les résultats.' },
    execute: (inp) => [
      { text: SAVE_SCRIPT('regression.py'), code: { name: 'regression.py', body: REG_PY(val(inp, 'file', 'data/my_data.csv'), val(inp, 'formula', 'y ~ x1 + x2')) } },
      { text: { en: 'Run it and copy everything it prints.', fr: 'Lancez-le et copiez tout ce qu’il affiche.' }, command: 'python regression.py' },
    ],
    expected: { en: 'A table titled OLS Regression Results with No. Observations and R-squared, then ROWS=, NOBS= and STATSMODELS=.', fr: 'Un tableau intitulé OLS Regression Results avec No. Observations et R-squared, puis ROWS=, NOBS= et STATSMODELS=.' },
    evidence: ['output', 'errors'],
    criteria: [{ en: 'The full result table is printed.', fr: 'Le tableau complet est affiché.' }, { en: 'The observations used are compared with the rows in the file.', fr: 'Les observations utilisées sont comparées aux lignes du fichier.' }, { en: 'Interpreting coefficients and tests is your scientific work.', fr: 'Interpréter les coefficients et les tests est votre travail scientifique.' }],
    risks: [{ problem: { en: 'PatsyError: Error evaluating factor', fr: 'PatsyError: Error evaluating factor' }, fix: { en: 'A name in the formula is not a column of the file. Names are case-sensitive.', fr: 'Un nom de la formule n’est pas une colonne du fichier. Les majuscules comptent.' } }, common.venv],
    validate: (ev) => regressionReview(ev, 'python'),
  },
  {
    id: 'regression-r',
    type: 'statistical',
    resource: 'pc',
    steps: ['research', 'evidence'],
    work: ['statistics_r'],
    env: 'r',
    title: { en: 'Fit your regression model in R', fr: 'Estimer votre modèle de régression dans R' },
    objective: { en: 'Fit the regression written in your method chapter with lm() on your data, and keep the full summary.', fr: 'Estimer la régression décrite dans votre chapitre de méthode avec lm() sur vos données, et garder le résumé complet.' },
    why: { en: 'R runs on your computer with your full dataset, which stays there.', fr: 'R fonctionne sur votre ordinateur avec tout votre jeu de données, qui y reste.' },
    tools: ['r'],
    inputs: [FILE_INPUT, { id: 'formula', kind: 'formula', required: true, label: { en: 'Model formula', fr: 'Formule du modèle' }, hint: { en: 'Outcome ~ predictors, with your column names.', fr: 'Variable expliquée ~ variables explicatives, avec vos noms de colonnes.' }, placeholder: 'y ~ x1 + x2' }],
    config: { en: 'Write down why each variable is in the model, and how missing values are handled (lm drops incomplete rows by default).', fr: 'Notez pourquoi chaque variable est dans le modèle, et comment les valeurs manquantes sont traitées (lm ignore par défaut les lignes incomplètes).' },
    execute: (inp) => [
      { text: SAVE_SCRIPT('regression.R'), code: { name: 'regression.R', body: REG_R(val(inp, 'file', 'data/my_data.csv'), val(inp, 'formula', 'y ~ x1 + x2')) } },
      { text: { en: 'In the R console, run the script and copy everything it prints.', fr: 'Dans la console R, lancez le script et copiez tout ce qu’il affiche.' }, command: 'source("regression.R")' },
    ],
    expected: { en: 'The summary with Call:, Residuals:, Coefficients:, Residual standard error and Multiple R-squared, then ROWS=, NOBS= and R_VERSION=.', fr: 'Le résumé avec Call:, Residuals:, Coefficients:, Residual standard error et Multiple R-squared, puis ROWS=, NOBS= et R_VERSION=.' },
    evidence: ['output', 'errors'],
    criteria: [{ en: 'The full summary is printed.', fr: 'Le résumé complet est affiché.' }, { en: 'The observations used are compared with the rows in the file.', fr: 'Les observations utilisées sont comparées aux lignes du fichier.' }, { en: 'Interpreting the results is your scientific work.', fr: 'Interpréter les résultats est votre travail scientifique.' }],
    risks: [
      { problem: { en: "object 'x' not found", fr: "object 'x' not found" }, fix: { en: 'A name in the formula is not a column. Run names(data) after read.csv to see the exact names.', fr: 'Un nom de la formule n’est pas une colonne. Lancez names(data) après read.csv pour voir les noms exacts.' } },
      { problem: { en: 'could not find function', fr: 'could not find function' }, fix: { en: 'The function comes from a package that is not loaded. Install it with install.packages("name") and load it with library(name).', fr: 'La fonction vient d’un paquet non chargé. Installez-le avec install.packages("nom") et chargez-le avec library(nom).' } },
    ],
    validate: (ev) => regressionReview(ev, 'r'),
  },
  {
    id: 'simulation',
    type: 'simulation',
    resource: 'pc',
    steps: ['research', 'experiments'],
    work: ['simulation', 'python'],
    env: 'python',
    title: { en: 'Run your simulation twice with the same seed', fr: 'Lancer votre simulation deux fois avec la même graine' },
    objective: { en: 'Show that your simulation gives the same results when run again with the same seed and settings, so others can reproduce it.', fr: 'Montrer que la simulation donne les mêmes résultats quand on la relance avec la même graine et les mêmes réglages, pour que d’autres puissent la reproduire.' },
    why: { en: 'Simulations can run for a long time and use much memory. They run on your computer.', fr: 'Une simulation peut durer longtemps et utiliser beaucoup de mémoire. Elle tourne sur votre ordinateur.' },
    tools: ['python', 'venv', 'numpy', 'scipy'],
    inputs: [{ id: 'script', kind: 'text', required: true, label: { en: 'Your simulation script', fr: 'Votre script de simulation' }, placeholder: 'simulate.py' }],
    config: { en: 'Keep every parameter (time step, duration, seed, model constants) in one configuration file or at the top of the script.', fr: 'Gardez tous les paramètres (pas de temps, durée, graine, constantes du modèle) dans un fichier de configuration ou en haut du script.' },
    execute: (inp) => [
      { text: { en: 'Fix the seed of every random generator your script uses (for example numpy.random.default_rng(seed)).', fr: 'Fixez la graine de chaque générateur aléatoire utilisé (par exemple numpy.random.default_rng(seed)).' } },
      { text: { en: 'Print the seed, the number of steps and each result in this form.', fr: 'Affichez la graine, le nombre de pas et chaque résultat sous cette forme.' }, code: { name: 'add to your script', body: SIM_PY } },
      { text: { en: 'Run it once, copy the output, then run it a second time without changing anything and copy that output too.', fr: 'Lancez-le une fois, copiez la sortie, puis relancez sans rien changer et copiez aussi cette sortie.' }, command: `python ${/^[A-Za-z0-9_./-]+\.py$/.test((inp.script ?? '').trim()) ? inp.script.trim() : 'simulate.py'}` },
    ],
    expected: { en: 'Twice the same lines: SEED=, STEPS= and one RESULT line per result, with identical values.', fr: 'Deux fois les mêmes lignes : SEED=, STEPS= et une ligne RESULT par résultat, avec des valeurs identiques.' },
    evidence: ['output', 'output2', 'config', 'files', 'errors'],
    criteria: [{ en: 'Both runs use the same seed.', fr: 'Les deux exécutions utilisent la même graine.' }, { en: 'Every result is identical in both runs.', fr: 'Chaque résultat est identique dans les deux exécutions.' }],
    risks: [{ problem: { en: 'The results differ between runs', fr: 'Les résultats diffèrent entre les exécutions' }, fix: { en: 'A random generator is not seeded, or the code depends on time, file order or parallel threads. Seed every generator and sort inputs.', fr: 'Un générateur aléatoire n’a pas de graine, ou le code dépend de l’heure, de l’ordre des fichiers ou de fils parallèles. Fixez chaque graine et triez les entrées.' } }, common.traceback],
    validate: (ev) => simulationReview(ev),
  },
  {
    id: 'qualitative-coding',
    type: 'manual',
    resource: 'light',
    steps: ['research', 'evidence'],
    work: ['qualitative'],
    env: 'none',
    title: { en: 'Code your interviews and record the codebook', fr: 'Coder vos entretiens et noter le livre de codes' },
    objective: { en: 'Code your anonymised transcripts in a qualitative tool such as Taguette, build a codebook that defines each code, and export it.', fr: 'Coder vos transcriptions anonymisées dans un outil qualitatif comme Taguette, construire un livre de codes qui définit chaque code, et l’exporter.' },
    why: { en: 'Coding is easier on a computer with a large screen, but nothing heavy runs: you can return the evidence from your phone.', fr: 'Le codage est plus simple sur un ordinateur avec un grand écran, mais rien de lourd ne tourne : vous pouvez rendre les preuves depuis votre téléphone.' },
    tools: ['taguette'],
    inputs: [{ id: 'approach', kind: 'text', label: { en: 'Your coding approach (optional)', fr: 'Votre approche de codage (facultatif)' }, placeholder: 'thematic analysis, inductive' }],
    config: { en: 'Anonymise every transcript before importing it, following your ethics approval. Agree with your supervisor whether codes come from theory, from the data, or both.', fr: 'Anonymisez chaque transcription avant de l’importer, conformément à votre accord éthique. Convenez avec votre encadrant si les codes viennent de la théorie, des données, ou des deux.' },
    execute: () => [
      { text: { en: 'Create a project and import your anonymised transcripts.', fr: 'Créez un projet et importez vos transcriptions anonymisées.' } },
      { text: { en: 'Read each transcript and highlight passages, tagging each with a code. Write a short definition for every code.', fr: 'Lisez chaque transcription et surlignez des passages, en leur attribuant un code. Écrivez une courte définition pour chaque code.' } },
      { text: { en: 'Export the codebook and the highlights from the tool, and keep the files with your research data.', fr: 'Exportez le livre de codes et les extraits depuis l’outil, et gardez les fichiers avec vos données de recherche.' } },
    ],
    expected: { en: 'An exported codebook and highlights file, and the counts of documents, codes and highlights shown in the tool.', fr: 'Un livre de codes et un fichier d’extraits exportés, et le nombre de documents, de codes et d’extraits affiché par l’outil.' },
    evidence: ['files', 'screenshots'],
    counts: [
      { id: 'documents', label: { en: 'Documents coded', fr: 'Documents codés' } },
      { id: 'codes', label: { en: 'Codes in the codebook', fr: 'Codes dans le livre de codes' } },
      { id: 'highlights', label: { en: 'Highlights (coded passages)', fr: 'Extraits codés' } },
    ],
    confirmations: [
      { id: 'anonymised', label: { en: 'Every transcript was anonymised before import.', fr: 'Chaque transcription a été anonymisée avant l’import.' } },
      { id: 'defined', label: { en: 'Every code has a written definition.', fr: 'Chaque code a une définition écrite.' } },
    ],
    criteria: [{ en: 'The counts, the exported files and both confirmations are given.', fr: 'Les nombres, les fichiers exportés et les deux confirmations sont donnés.' }, { en: 'Supervisor cannot check coding: it stays reported by you, for your supervisor to review.', fr: 'Supervisor ne peut pas vérifier le codage : il reste déclaré par vous, pour relecture par votre encadrant.' }],
    risks: [{ problem: { en: 'Too many codes', fr: 'Trop de codes' }, fix: { en: 'Group similar codes under broader themes and merge codes used only once, then update the definitions.', fr: 'Regroupez les codes proches sous des thèmes plus larges et fusionnez ceux utilisés une seule fois, puis mettez à jour les définitions.' } }],
    validate: (ev) => qualitativeReview(ev, TEMPLATES_BY_ID['qualitative-coding'].counts ?? [], TEMPLATES_BY_ID['qualitative-coding'].confirmations ?? []),
  },
  {
    id: 'environment-snapshot',
    type: 'terminal',
    resource: 'pc',
    steps: ['experiments', 'evidence', 'research'],
    work: [...PY],
    env: 'python',
    title: { en: 'Record the exact versions of your environment', fr: 'Noter les versions exactes de votre environnement' },
    objective: { en: 'Save the list of installed packages and their versions, so your results can be reproduced and reported in the method chapter.', fr: 'Enregistrer la liste des paquets installés et leurs versions, pour que vos résultats soient reproductibles et décrits dans le chapitre de méthode.' },
    why: { en: 'Only your research computer knows which versions it uses.', fr: 'Seul votre ordinateur de recherche sait quelles versions il utilise.' },
    tools: ['python', 'venv', 'pip'],
    inputs: [{ id: 'packages', kind: 'list', label: { en: 'Packages your results depend on', fr: 'Paquets dont dépendent vos résultats' }, hint: { en: 'For example numpy, pandas, torch.', fr: 'Par exemple numpy, pandas, torch.' } }],
    config: { en: 'Run it in the same environment as your experiments, with .venv active.', fr: 'Lancez-le dans le même environnement que vos expériences, avec .venv actif.' },
    execute: () => [
      { text: { en: 'Save the list into requirements.txt in your project folder. Keep this file with your results.', fr: 'Enregistrez la liste dans requirements.txt dans le dossier du projet. Gardez ce fichier avec vos résultats.' }, command: 'python -m pip freeze > requirements.txt' },
      { text: { en: 'Show the list, and copy what it prints.', fr: 'Affichez la liste, et copiez ce qu’elle affiche.' }, command: 'python -m pip freeze' },
    ],
    expected: { en: 'One line per package, such as numpy==2.1.3.', fr: 'Une ligne par paquet, comme numpy==2.1.3.' },
    evidence: ['output'],
    criteria: [{ en: 'Every package you named is listed with a version.', fr: 'Chaque paquet nommé apparaît avec sa version.' }],
    risks: [{ problem: { en: 'The list is almost empty', fr: 'La liste est presque vide' }, fix: { en: 'The project environment is probably not active. Activate .venv and run it again.', fr: 'L’environnement du projet n’est probablement pas actif. Activez .venv et relancez.' } }],
    validate: (ev, inp) => freezeReview(ev, inp),
  },
];
export const TEMPLATES_BY_ID: Record<string, Template> = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));
for (const t of TEMPLATES) for (const f of t.inputs) FIELD_KIND[f.id] ??= f.kind;

// ---------- Choosing tasks ----------

/** Tasks that fit the student's methodology and system. The GPU tasks only when a GPU is possible. */
export function suggestTasks(lab: Pick<LabState, 'workTypes' | 'os' | 'gpu'>, stepId?: string): Template[] {
  const chosen = new Set<string>(lab.workTypes);
  return TEMPLATES.filter((t) => t.work.some((w) => chosen.has(w)))
    .filter((t) => !lab.os || !t.os || t.os.includes(lab.os))
    .filter((t) => t.resource !== 'gpu' || (lab.gpu !== 'no' && lab.os !== 'macos'))
    .filter((t) => !stepId || t.steps.includes(stepId));
}

/** The catalogue tools a task needs, with their Lab status. Unknown ids are skipped. */
export function prerequisites(t: Template, lab: LabState | undefined, known: Set<string>) {
  return t.tools.filter((id) => known.has(id)).map((id) => ({ id, status: statusOf(lab?.tools[id], lab?.os ?? null) }));
}

// ---------- Submitting evidence ----------

/** Keeps the start and the end of a long log. */
export function trimLog(text: string, head = KEEP_HEAD, tail = KEEP_TAIL): { text: string; trimmed: boolean } {
  if (text.length <= head + tail + 200) return { text, trimmed: false };
  const cut = text.length - head - tail;
  return { text: `${text.slice(0, head)}\n[… ${cut} characters not kept: the full log was checked, then shortened …]\n${text.slice(-tail)}`, trimmed: true };
}

export type Submit = { ok: true; task: ExecTask } | { ok: false; problem: 'secret' | 'too_long' | 'inputs' };

/** Checks the evidence, then keeps a redacted, shortened copy. A button press alone never produces a review. */
export function submitEvidence(task: ExecTask, ev: Evidence, ctx: Ctx, now = new Date().toISOString()): Submit {
  const t = TEMPLATES_BY_ID[task.template];
  if (!t) return { ok: false, problem: 'inputs' };
  const texts = [ev.output, ev.output2, ev.metrics, ev.config, ev.files, ev.errors, ev.screenshots];
  if (texts.some((x) => x.length > MAX_PASTE)) return { ok: false, problem: 'too_long' };
  if (texts.some((x) => findSensitive(x).includes('secret'))) return { ok: false, problem: 'secret' };
  if (t.inputs.some((f) => inputProblem(f, task.inputs[f.id] ?? ''))) return { ok: false, problem: 'inputs' };
  const r = t.validate(ev, task.inputs, ctx);
  const chars = ev.output.length + ev.output2.length;
  const a = trimLog(redact(ev.output).text);
  const b = trimLog(redact(ev.output2).text);
  const keep = (s: string, max: number) => redact(s).text.slice(0, max);
  const evidence: Evidence = {
    output: a.text,
    output2: b.text,
    metrics: keep(ev.metrics, LIMITS.metrics),
    config: keep(ev.config, LIMITS.config),
    files: keep(ev.files, LIMITS.files),
    errors: trimLog(keep(ev.errors, 20_000), 1500, 1500).text,
    screenshots: keep(ev.screenshots, LIMITS.screenshots),
    counts: Object.fromEntries((t.counts ?? []).map((c) => [c.id, (ev.counts[c.id] ?? '').trim().slice(0, LIMITS.count)])),
    confirmed: (t.confirmations ?? []).map((c) => c.id).filter((id) => ev.confirmed.includes(id)),
  };
  const stored: StoredReview = { ...r, found: r.found.map(([k, v]) => [k, redact(v).text]), at: now, rule: EXEC_RULES_VERSION, ...(a.trimmed || b.trimmed ? { trimmed: true, chars } : {}) };
  return { ok: true, task: { ...task, evidence, review: stored, stage: 7, updatedAt: now } };
}

/** A review from an older rule must be submitted again. */
export const currentReview = (task: ExecTask) => (task.review && task.review.rule === EXEC_RULES_VERSION ? task.review : undefined);

// ---------- Tasks in PathState ----------

export function newTask(template: string, stepId?: string, now = new Date().toISOString(), id = makeId()): ExecTask {
  const t = TEMPLATES_BY_ID[template];
  return { id, template, stepId: stepId && t?.steps.includes(stepId) ? stepId : t?.steps[0] ?? 'research', stage: 0, inputs: {}, evidence: emptyEvidence(), createdAt: now, updatedAt: now };
}
function makeId() {
  try {
    return `task-${crypto.randomUUID()}`;
  } catch {
    return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const STATUSES: ReviewStatus[] = ['verified', 'reported', 'incomplete', 'failed', 'needs_review'];

function cleanReview(v: unknown): StoredReview | undefined {
  const r = v as StoredReview;
  if (!r || typeof r !== 'object' || !STATUSES.includes(r.status)) return undefined;
  return {
    status: r.status,
    reasons: Array.isArray(r.reasons) ? r.reasons.filter((x) => typeof x === 'string').map((x) => x.slice(0, 120)).slice(0, 12) : [],
    found: Array.isArray(r.found) ? r.found.filter((x) => Array.isArray(x) && typeof x[0] === 'string' && typeof x[1] === 'string').map(([k, val]) => [k.slice(0, 40), val.slice(0, 80)] as [string, string]).slice(0, 16) : [],
    metrics: Array.isArray(r.metrics) ? r.metrics.filter((m) => m && typeof m.name === 'string' && typeof m.value === 'number' && Number.isFinite(m.value)).map((m) => ({ name: m.name.slice(0, 40), value: m.value })).slice(0, 40) : [],
    at: str(r.at, 40),
    rule: typeof r.rule === 'number' ? r.rule : 0,
    ...(r.trimmed === true ? { trimmed: true, chars: typeof r.chars === 'number' ? r.chars : 0 } : {}),
  };
}

const OUT_MAX = KEEP_HEAD + KEEP_TAIL + 200;
function cleanTask(v: unknown): ExecTask | null {
  const t = v as ExecTask;
  if (!t || typeof t !== 'object' || typeof t.id !== 'string' || !/^task-[A-Za-z0-9-]{4,60}$/.test(t.id) || !TEMPLATES_BY_ID[t.template]) return null;
  const tpl = TEMPLATES_BY_ID[t.template];
  const e = (t.evidence ?? {}) as Partial<Evidence>;
  const inputs: Record<string, string> = {};
  for (const f of tpl.inputs) if (typeof t.inputs?.[f.id] === 'string') inputs[f.id] = t.inputs[f.id].slice(0, LIMITS.input);
  const review = cleanReview(t.review);
  return {
    id: t.id,
    template: t.template,
    stepId: tpl.steps.includes(t.stepId) ? t.stepId : tpl.steps[0],
    stage: Number.isInteger(t.stage) && t.stage >= 0 && t.stage < STAGES.length ? t.stage : 0,
    inputs,
    evidence: {
      output: str(e.output, OUT_MAX),
      output2: str(e.output2, OUT_MAX),
      metrics: str(e.metrics, LIMITS.metrics),
      config: str(e.config, LIMITS.config),
      files: str(e.files, LIMITS.files),
      errors: str(e.errors, 3200),
      screenshots: str(e.screenshots, LIMITS.screenshots),
      counts: Object.fromEntries((tpl.counts ?? []).map((c) => [c.id, str(e.counts?.[c.id], LIMITS.count)]).filter(([, x]) => x)),
      confirmed: Array.isArray(e.confirmed) ? e.confirmed.filter((x) => (tpl.confirmations ?? []).some((c) => c.id === x)) : [],
    },
    ...(review ? { review } : {}),
    ...(typeof t.runId === 'string' && /^[A-Za-z0-9-]{6,40}$/.test(t.runId) ? { runId: t.runId } : {}),
    createdAt: str(t.createdAt, 40),
    updatedAt: str(t.updatedAt, 40) || str(t.createdAt, 40),
  };
}

/** Reads stored tasks. Anything damaged is dropped instead of breaking the page. */
export function cleanExecution(v: unknown): ExecutionState {
  const tasks = Array.isArray((v as ExecutionState)?.tasks) ? (v as ExecutionState).tasks : [];
  const seen = new Set<string>();
  return { tasks: tasks.map(cleanTask).filter((t): t is ExecTask => !!t && !seen.has(t.id) && (seen.add(t.id), true)).slice(0, MAX_TASKS) };
}

/** A run record draft from a reviewed task. Numbers come only from what the student's output printed. */
export function runFromTask(task: ExecTask) {
  const t = TEMPLATES_BY_ID[task.template];
  const r = currentReview(task);
  if (!t || !r || !r.metrics.length || !['needs_review', 'verified'].includes(r.status)) return null;
  const f = Object.fromEntries(r.found);
  return {
    step: task.stepId === 'research' ? ('research' as const) : ('experiments' as const),
    stepId: task.stepId,
    outcome: 'completed' as const,
    name: `${t.title.en}${task.inputs.script ? ` (${task.inputs.script})` : ''}`.slice(0, 80),
    purpose: t.objective.en,
    dataset: task.inputs.file ?? '',
    split: '',
    model: task.inputs.baseline ? `compared with ${task.inputs.baseline}` : '',
    settings: task.evidence.config,
    seeds: f.seed ?? '',
    versions: '',
    hardware: f.device ?? '',
    duration: '',
    metrics: r.metrics.map((m) => ({ name: m.name, value: m.value, split: 'other' as const })),
    log: task.evidence.output.slice(-2000),
    notes: `From the execution task "${t.title.en}". Evidence checked by Supervisor on ${r.at.slice(0, 10)}: ${r.status === 'verified' ? 'verified' : 'complete, results need scientific review'}.`,
  };
}
