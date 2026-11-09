// Deterministic checks of the output a student pastes after running a verification command.
// No AI is involved. Each tool has its own rule. The pasted text is never stored: only the result,
// the version found and a short reason code are kept.

import { fill, t, type Lang } from './i18n';
import type { GpuAnswer, Os } from './software';

/** Raise this when a rule changes, so older results are shown as needing a new check. */
export const LAB_RULES_VERSION = 1;
export const MAX_OUTPUT = 6000;

export type CheckStatus = 'verified' | 'failed' | 'manual_review';
export type CheckResult = {
  status: CheckStatus | 'empty' | 'blocked';
  /** What was found, for example "Python 3.12.7". Never a path or a name. */
  found?: string;
  /** Short reason code, mapped to text and next steps in the interface. */
  reason: string;
};

export type Context = { os: Os; gpu: GpuAnswer };

/** The exact verification command for each tool and system. The catalogue must use the same text. */
export const VERIFY_COMMANDS: Record<string, Partial<Record<Os, string>>> = {
  python: { windows: 'python --version', macos: 'python3 --version', linux: 'python3 --version' },
  pip: { windows: 'py -m pip --version', macos: 'python3 -m pip --version', linux: 'python3 -m pip --version' },
  venv: { windows: 'where python', macos: 'which python', linux: 'which python' },
  git: { windows: 'git --version', macos: 'git --version', linux: 'git --version' },
  vscode: { windows: 'code --version', macos: 'code --version', linux: 'code --version' },
  jupyterlab: all(pkgCommand('jupyterlab', 'jupyterlab')),
  numpy: all(pkgCommand('numpy', 'numpy')),
  pandas: all(pkgCommand('pandas', 'pandas')),
  matplotlib: all(pkgCommand('matplotlib', 'matplotlib')),
  'scikit-learn': all(pkgCommand('sklearn', 'scikit-learn')),
  pytorch: all(`python -c "import torch; print('torch', torch.__version__, 'cuda', torch.cuda.is_available())"`),
  'nvidia-gpu': { windows: 'nvidia-smi', linux: 'nvidia-smi' },
};

function all(command: string): Record<Os, string> {
  return { windows: command, macos: command, linux: command };
}
/** The command prints a label before the version, so a bare number from another tool cannot pass. */
function pkgCommand(module: string, label: string) {
  return `python -c "import ${module}; print('${label}', ${module}.__version__)"`;
}

// ---------- Sensitive information ----------

export type Sensitive = 'user_path' | 'email' | 'ip' | 'secret';

const SECRET = [
  /\bsk-[A-Za-z0-9_-]{16,}/, // API keys in the common sk- format
  /\bgh[pousr]_[A-Za-z0-9]{20,}/, // GitHub tokens
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access keys
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, // JSON web tokens
  /\b(password|passwd|pwd|token|secret|api[_-]?key)\s*[:=]/i,
];

/** Finds things a student should not share. Secrets stop the check; the rest only warn. */
export function findSensitive(text: string): Sensitive[] {
  const found = new Set<Sensitive>();
  if (/[A-Za-z]:\\Users\\[^\\\s]+/i.test(text) || /\/(Users|home)\/[^/\s]+/.test(text)) found.add('user_path');
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(text)) found.add('email');
  if (/\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(text) && [...text.matchAll(/\b((?:\d{1,3}\.){3}\d{1,3})\b/g)].some((m) => m[1].split('.').every((n) => +n <= 255) && !isVersionContext(text, m.index ?? 0))) found.add('ip');
  if (SECRET.some((r) => r.test(text))) found.add('secret');
  return [...found];
}
/** "Driver Version: 560.94.0.1" style numbers are versions, not addresses. */
function isVersionContext(text: string, at: number) {
  return /(version|python|pip|torch|cuda|git|smi)[^\n]{0,24}$/i.test(text.slice(Math.max(0, at - 30), at));
}

// ---------- Helpers ----------

const NOT_FOUND = [
  /is not recognized as an internal or external command/i,
  /is not recognized as the name of a cmdlet/i,
  /command not found/i,
  /no such file or directory/i,
  /could not find files for the given pattern/i,
];
const MISSING_MODULE = /ModuleNotFoundError|No module named/i;
const PYTHON_STORE_STUB = /Python was not found; run without arguments to install from the Microsoft Store/i;

/** Splits the output into lines and drops the echoed prompt line, such as "C:\project> git --version". */
export function cleanLines(text: string, command?: string) {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !(command && l.endsWith(command) && l.length > command.length && /[>$#%]\s*$/.test(l.slice(0, l.length - command.length))) && l !== command);
}

const VERSION = String.raw`\d+\.\d+(?:\.\d+)?(?:[a-z]+\d*|\.post\d+|\.dev\d+|\+[A-Za-z0-9.]+)?`;

function pkgRule(label: string, name: string, installName: string): Rule {
  return (lines) => {
    const m = lines.length === 1 ? lines[0].match(new RegExp(`^${label.replace(/[-]/g, '\\-')} (${VERSION})$`)) : null;
    if (m) return { status: 'verified', found: `${name} ${m[1]}`, reason: 'ok' };
    if (lines.some((l) => MISSING_MODULE.test(l))) return { status: 'failed', reason: `missing_module:${installName}` };
    return { status: 'failed', reason: 'unrelated' };
  };
}

type Rule = (lines: string[], ctx: Context) => CheckResult;

// ---------- Rules for each tool ----------

export const RULES: Record<string, Rule> = {
  python(lines) {
    if (lines.some((l) => PYTHON_STORE_STUB.test(l))) return { status: 'failed', reason: 'python_store_stub' };
    const m = lines.length === 1 ? lines[0].match(/^Python (\d+)\.(\d+)\.(\d+)((?:a|b|rc)\d+)?\+?$/) : null;
    if (!m) return { status: 'failed', reason: 'unrelated' };
    const [major, minor] = [+m[1], +m[2]];
    const found = `Python ${m[1]}.${m[2]}.${m[3]}${m[4] ?? ''}`;
    if (major !== 3) return { status: 'failed', found, reason: 'python_2' };
    // scikit-learn 1.7 needs Python 3.10 or later (official install page).
    if (minor < 10) return { status: 'failed', found, reason: 'python_too_old' };
    if (m[4]) return { status: 'manual_review', found, reason: 'python_prerelease' };
    return { status: 'verified', found, reason: 'ok' };
  },

  pip(lines) {
    if (lines.some((l) => /No module named pip/i.test(l))) return { status: 'failed', reason: 'pip_missing' };
    const m = lines.length === 1 ? lines[0].match(/^pip (\d+(?:\.\d+)*) from .+ \(python (\d+\.\d+)\)$/) : null;
    if (!m) return { status: 'failed', reason: 'unrelated' };
    return { status: 'verified', found: `pip ${m[1]} (Python ${m[2]})`, reason: 'ok' };
  },

  venv(lines, { os }) {
    const first = lines[0] ?? '';
    if (lines.some((l) => /could not find files/i.test(l))) return { status: 'failed', reason: 'venv_no_python' };
    if (os === 'windows') {
      if (!/^[A-Za-z]:\\.*python\.exe$/i.test(first)) return { status: 'failed', reason: 'unrelated' };
      if (/\\\.venv\\Scripts\\python\.exe$/i.test(first)) return { status: 'verified', found: 'Project environment (.venv) active', reason: 'ok' };
      if (/\\[^\\]*env[^\\]*\\Scripts\\python\.exe$/i.test(first)) return { status: 'manual_review', reason: 'venv_other_name' };
      return { status: 'failed', reason: 'venv_not_active' };
    }
    if (!/^\/.*\/python3?$/.test(first)) return { status: 'failed', reason: 'unrelated' };
    if (/\/\.venv\/bin\/python3?$/.test(first)) return { status: 'verified', found: 'Project environment (.venv) active', reason: 'ok' };
    if (/\/[^/]*env[^/]*\/bin\/python3?$/.test(first)) return { status: 'manual_review', reason: 'venv_other_name' };
    return { status: 'failed', reason: 'venv_not_active' };
  },

  git(lines) {
    if (lines.some((l) => /xcode-select/i.test(l))) return { status: 'failed', reason: 'git_xcode' };
    const m = lines.length === 1 ? lines[0].match(/^git version (\d+\.\d+(?:\.\d+)?)(?:\.windows\.\d+| \(Apple Git-[\d.]+\))?$/) : null;
    if (!m) return { status: 'failed', reason: 'unrelated' };
    return { status: 'verified', found: `Git ${m[1]}`, reason: 'ok' };
  },

  vscode(lines) {
    const ok = lines.length === 3 && /^\d+\.\d+\.\d+$/.test(lines[0]) && /^[0-9a-f]{40}$/.test(lines[1]) && /^(x64|arm64|ia32|armhf)$/.test(lines[2]);
    if (!ok) return { status: 'failed', reason: 'unrelated' };
    return { status: 'verified', found: `Visual Studio Code ${lines[0]}`, reason: 'ok' };
  },

  jupyterlab: pkgRule('jupyterlab', 'JupyterLab', 'jupyterlab'),
  numpy: pkgRule('numpy', 'NumPy', 'numpy'),
  pandas: pkgRule('pandas', 'pandas', 'pandas'),
  matplotlib: pkgRule('matplotlib', 'Matplotlib', 'matplotlib'),
  'scikit-learn': pkgRule('scikit-learn', 'scikit-learn', 'scikit-learn'),

  pytorch(lines, { gpu }) {
    if (lines.some((l) => MISSING_MODULE.test(l))) return { status: 'failed', reason: 'missing_module:torch' };
    const m = lines.length === 1 ? lines[0].match(new RegExp(`^torch (${VERSION}) cuda (True|False)$`)) : null;
    if (!m) return { status: 'failed', reason: 'unrelated' };
    const cuda = m[2] === 'True';
    const found = `PyTorch ${m[1]}, ${cuda ? 'GPU (CUDA) available' : 'CPU only'}`;
    // The student said there is an NVIDIA card, but PyTorch cannot use it. That may be on purpose, so a person decides.
    if (gpu === 'yes' && !cuda) return { status: 'manual_review', found, reason: 'torch_no_cuda' };
    return { status: 'verified', found, reason: 'ok' };
  },

  'nvidia-gpu'(lines) {
    const text = lines.join('\n');
    if (/couldn't communicate with the NVIDIA driver/i.test(text)) return { status: 'failed', reason: 'nvidia_no_driver' };
    const m = text.match(/NVIDIA-SMI\s+[\d.]+\s+Driver Version:\s*([\d.]+)(?:\s+CUDA Version:\s*([\d.]+))?/);
    if (!m) return { status: 'failed', reason: 'unrelated' };
    return { status: 'verified', found: `NVIDIA driver ${m[1]}${m[2] ? `, supports CUDA up to ${m[2]}` : ''}`, reason: 'ok' };
  },
};

/** Checks pasted output for one tool. Nothing leaves the browser and the text is not kept. */
export function verifyOutput(toolId: string, raw: string, ctx: Context): CheckResult {
  const rule = RULES[toolId];
  const command = VERIFY_COMMANDS[toolId]?.[ctx.os];
  if (!rule || !command) return { status: 'manual_review', reason: 'no_rule' };
  const text = (raw ?? '').trim();
  if (!text) return { status: 'empty', reason: 'empty' };
  if (text.length > MAX_OUTPUT) return { status: 'failed', reason: 'too_long' };
  if (findSensitive(text).includes('secret')) return { status: 'blocked', reason: 'secret' };
  const lines = cleanLines(text, command);
  if (!lines.length) return { status: 'failed', reason: 'command_only' };
  if (lines.some((l) => NOT_FOUND.some((r) => r.test(l))) && toolId !== 'venv') return { status: 'failed', reason: 'not_found' };
  return rule(lines, ctx);
}

// ---------- What to tell the student ----------

/** Plain explanation and next step for each reason code, in the chosen language. */
export function explain(reason: string, command: string, lang: Lang = 'en'): { text: string; next?: string } {
  const m = t(lang);
  const [code, pkg] = reason.split(':');
  const [text, next] = m.reasons[code] ?? m.reasons.unknown;
  const v = { cmd: command, pkg: pkg ?? '' };
  return { text: fill(text, v), ...(next ? { next: fill(next, v) } : {}) };
}
