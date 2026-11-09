// Shared by the server and the browser. Reading the files happens in softwareCatalog.ts.

export type Os = 'windows' | 'macos' | 'linux';
export type WorkType = 'statistics' | 'data_science' | 'machine_learning' | 'deep_learning' | 'computer_vision' | 'nlp';
export type GpuAnswer = 'yes' | 'no' | 'not_sure';
export type Step = { text: string; command?: string };
export type Check = { command: string; expected: string };
export type Software = {
  id: string;
  name: string;
  kind: 'application' | 'python_package' | 'guidance';
  purpose: string;
  work_types: ('any' | WorkType)[];
  level: 'required' | 'recommended' | 'conditional';
  condition: null | 'nvidia_gpu';
  publisher_domain: string;
  official_download_url: string;
  official_docs_url: string;
  os: Os[];
  version_guidance: string;
  prerequisites: string[];
  install: Partial<Record<Os, Step[]>>;
  verify: Partial<Record<Os, Check>>;
  common_problems: { problem: string; solution: string }[];
  manual_review: string[];
  last_reviewed: string;
  sources: string[];
  /** Translated texts. Commands, links, names and versions are never translated. */
  i18n?: { fr?: SoftwareText };
};

/** The parts of an entry a student reads, in one language. */
export type SoftwareText = {
  purpose: string;
  version_guidance: string;
  install: Partial<Record<Os, string[]>>;
  expected: Partial<Record<Os, string>>;
  common_problems: { problem: string; solution: string }[];
};

/** The entry's text in the chosen language. Falls back to English for anything missing. */
export function textOf(e: Software, lang: 'en' | 'fr'): SoftwareText {
  const en: SoftwareText = {
    purpose: e.purpose,
    version_guidance: e.version_guidance,
    install: Object.fromEntries(Object.entries(e.install).map(([o, steps]) => [o, steps!.map((s) => s.text)])),
    expected: Object.fromEntries(Object.entries(e.verify).map(([o, v]) => [o, v!.expected])),
    common_problems: e.common_problems,
  };
  const fr = lang === 'fr' ? e.i18n?.fr : undefined;
  if (!fr) return en;
  return {
    purpose: fr.purpose || en.purpose,
    version_guidance: fr.version_guidance || en.version_guidance,
    install: Object.fromEntries(Object.entries(en.install).map(([o, steps]) => [o, steps!.map((t, i) => fr.install[o as Os]?.[i] || t)])),
    expected: Object.fromEntries(Object.entries(en.expected).map(([o, t]) => [o, fr.expected[o as Os] || t])),
    common_problems: en.common_problems.map((p, i) => fr.common_problems[i] ?? p),
  };
}

export const OS_LABELS: Record<Os, string> = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };

/** "Python programming" needs only the shared tools, so it has no catalogue tag of its own. */
export const WORK_TYPES: { id: WorkType | 'python'; label: string; hint: string }[] = [
  { id: 'python', label: 'Python programming', hint: 'Scripts, simulations, small programs' },
  { id: 'statistics', label: 'Statistical analysis', hint: 'Tests, regression, survey data' },
  { id: 'data_science', label: 'Data science', hint: 'Cleaning and exploring datasets' },
  { id: 'machine_learning', label: 'Machine learning', hint: 'Classic models such as random forests or SVMs' },
  { id: 'deep_learning', label: 'Deep learning', hint: 'Neural networks trained with PyTorch' },
  { id: 'computer_vision', label: 'Computer vision', hint: 'Images or video' },
  { id: 'nlp', label: 'Natural language processing', hint: 'Text and language models' },
];

/** Only these publisher hosts may appear in the catalogue. Exact host match, https only. */
export const ALLOWED_HOSTS = [
  'www.python.org',
  'docs.python.org',
  'packaging.python.org',
  'pip.pypa.io',
  'git-scm.com',
  'code.visualstudio.com',
  'jupyter.org',
  'numpy.org',
  'pandas.pydata.org',
  'matplotlib.org',
  'scikit-learn.org',
  'pytorch.org',
  'docs.pytorch.org',
  'www.nvidia.com',
  'docs.nvidia.com',
  'developer.nvidia.com',
] as const;

export function isOfficialUrl(raw: string) {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && (ALLOWED_HOSTS as readonly string[]).includes(u.hostname);
  } catch {
    return false;
  }
}

/** Order in the checklist: base tools first, then libraries, then GPU guidance. */
export const ORDER = ['python', 'pip', 'venv', 'git', 'vscode', 'jupyterlab', 'numpy', 'pandas', 'matplotlib', 'scikit-learn', 'pytorch', 'nvidia-gpu'];

export type Selection = { workTypes: (WorkType | 'python')[]; os: Os | null; gpu: GpuAnswer };

/** Returns only the tools this project needs on this system. Nothing is chosen until the student picks a work type. */
export function selectTools(catalogue: Software[], s: Selection): Software[] {
  if (!s.os || !s.workTypes.length) return [];
  const chosen = new Set(s.workTypes);
  return catalogue
    .filter((e) => e.os.includes(s.os!))
    .filter((e) => e.work_types.some((w) => w === 'any' || chosen.has(w)))
    .filter((e) => e.condition !== 'nvidia_gpu' || s.gpu !== 'no')
    .sort((a, b) => rank(a.id) - rank(b.id));
}

const rank = (id: string) => {
  const i = ORDER.indexOf(id);
  return i < 0 ? ORDER.length : i;
};

/** Checks that go beyond the JSON schema. Returns plain error messages. */
export function auditEntry(e: Software, known: Set<string>): string[] {
  const errors: string[] = [];
  const urls = [e.official_download_url, e.official_docs_url, ...e.sources];
  for (const u of urls) if (!isOfficialUrl(u)) errors.push(`${e.id}: ${u} is not an allowed official https address`);
  if (!(ALLOWED_HOSTS as readonly string[]).includes(e.publisher_domain)) errors.push(`${e.id}: publisher ${e.publisher_domain} is not allowed`);
  for (const os of e.os) {
    if (!e.install[os]?.length) errors.push(`${e.id}: no installation instructions for ${os}`);
    if (!e.verify[os]?.command) errors.push(`${e.id}: no verification command for ${os}`);
  }
  for (const os of Object.keys({ ...e.install, ...e.verify }) as Os[]) if (!e.os.includes(os)) errors.push(`${e.id}: instructions for ${os}, which it does not support`);
  for (const p of e.prerequisites) if (!known.has(p)) errors.push(`${e.id}: unknown prerequisite ${p}`);
  if (e.condition === 'nvidia_gpu' && e.level !== 'conditional') errors.push(`${e.id}: a conditional entry must use level "conditional"`);
  const fr = e.i18n?.fr;
  if (fr) {
    for (const os of e.os) {
      if (fr.install[os]?.length !== e.install[os]?.length) errors.push(`${e.id}: French installation steps for ${os} do not match the English steps`);
      if (!fr.expected[os]) errors.push(`${e.id}: no French expected output for ${os}`);
    }
    for (const os of Object.keys({ ...fr.install, ...fr.expected }) as Os[]) if (!e.os.includes(os)) errors.push(`${e.id}: French text for ${os}, which it does not support`);
    if (fr.common_problems.length !== e.common_problems.length) errors.push(`${e.id}: French common problems do not match the English list`);
  }
  return errors;
}

export function guessOs(userAgent: string): Os | null {
  if (/Android|iPhone|iPad/i.test(userAgent)) return null;
  if (/Windows/i.test(userAgent)) return 'windows';
  if (/Mac OS X|Macintosh/i.test(userAgent)) return 'macos';
  if (/Linux|X11/i.test(userAgent)) return 'linux';
  return null;
}
