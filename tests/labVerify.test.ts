import { describe, expect, it } from 'vitest';
import { loadCatalogue } from '@/lib/softwareCatalog';
import { cleanLines, explain, findSensitive, RULES, VERIFY_COMMANDS, verifyOutput, type Context } from '@/lib/labVerify';
import type { Os } from '@/lib/software';

// All outputs below are synthetic. Paths use a made-up account name.
const W: Context = { os: 'windows', gpu: 'not_sure' };
const M: Context = { os: 'macos', gpu: 'not_sure' };
const L: Context = { os: 'linux', gpu: 'not_sure' };

/** One correct output for each tool, used to prove every rule can pass on every system it supports. */
const GOOD: Record<string, string> = {
  python: 'Python 3.12.7',
  pip: 'pip 24.3.1 from C:\\Users\\student\\proj\\.venv\\Lib\\site-packages\\pip (python 3.12)',
  venv: 'C:\\Users\\student\\proj\\.venv\\Scripts\\python.exe\nC:\\Program Files\\Python312\\python.exe',
  git: 'git version 2.47.1.windows.1',
  vscode: '1.95.3\nf1a4fb101478ce6ec82fe9627c43efbf9e98c813\nx64',
  jupyterlab: 'jupyterlab 4.3.4',
  numpy: 'numpy 2.1.3',
  pandas: 'pandas 2.2.3',
  matplotlib: 'matplotlib 3.9.2',
  'scikit-learn': 'scikit-learn 1.7.0',
  pytorch: 'torch 2.9.0+cu128 cuda True',
  'nvidia-gpu': '+-----------------------------------------------------------------------------------------+\n| NVIDIA-SMI 566.14                 Driver Version: 566.14         CUDA Version: 12.7     |\n|-----------------------------------------+------------------------+----------------------+\n| GPU  Name                  Driver-Model | Bus-Id          Disp.A | Volatile Uncorr. ECC |',
};
const UNIX_GOOD: Record<string, string> = { ...GOOD, venv: '/home/student/proj/.venv/bin/python', pip: 'pip 24.3.1 from /home/student/proj/.venv/lib/python3.12/site-packages/pip (python 3.12)', git: 'git version 2.39.5 (Apple Git-154)' };

describe('rules cover the catalogue', () => {
  const catalogue = loadCatalogue();

  it('has one rule and one command for every tool and system in the catalogue', () => {
    for (const e of catalogue) {
      expect(RULES[e.id], e.id).toBeTypeOf('function');
      for (const os of e.os) expect(VERIFY_COMMANDS[e.id]?.[os], `${e.id} ${os}`).toBeTruthy();
    }
    expect(Object.keys(RULES).sort()).toEqual(catalogue.map((e) => e.id).sort());
  });

  it('uses exactly the command the catalogue shows to students', () => {
    for (const e of catalogue) for (const os of e.os) expect(e.verify[os]!.command, `${e.id} ${os}`).toBe(VERIFY_COMMANDS[e.id][os]);
  });

  it('verifies a correct output for every tool on every supported system', () => {
    for (const e of catalogue)
      for (const os of e.os as Os[]) {
        const out = os === 'windows' ? GOOD[e.id] : UNIX_GOOD[e.id];
        expect(verifyOutput(e.id, out, { os, gpu: 'not_sure' }).status, `${e.id} ${os}`).toBe('verified');
      }
  });

  it('rejects empty, unrelated and malformed output for every tool', () => {
    for (const e of catalogue)
      for (const os of e.os as Os[]) {
        const ctx = { os, gpu: 'not_sure' as const };
        expect(verifyOutput(e.id, '   \n ', ctx).status).toBe('empty');
        expect(verifyOutput(e.id, 'hello, I installed it yesterday', ctx).status, `${e.id} unrelated`).toBe('failed');
        expect(verifyOutput(e.id, '3.12.7', ctx).status, `${e.id} bare number`).toBe('failed');
        expect(verifyOutput(e.id, 'version 1.2.3', ctx).status, `${e.id} any version`).toBe('failed');
      }
  });

  it('never accepts the correct output of one tool as proof for another', () => {
    for (const a of catalogue)
      for (const b of catalogue) {
        if (a.id === b.id || !b.os.includes('windows')) continue;
        if (['venv', 'pip'].includes(a.id) && ['venv', 'pip'].includes(b.id)) continue;
        expect(verifyOutput(b.id, GOOD[a.id], W).status, `${a.id} output for ${b.id}`).not.toBe('verified');
      }
  });
});

describe('Python', () => {
  it('accepts Python 3.10 and later', () => {
    expect(verifyOutput('python', 'Python 3.12.7', W)).toEqual({ status: 'verified', found: 'Python 3.12.7', reason: 'ok' });
    expect(verifyOutput('python', 'Python 3.10.0', L).status).toBe('verified');
    expect(verifyOutput('python', 'Python 3.15.2', M).status).toBe('verified');
  });
  it('fails old and wrong versions with a reason', () => {
    expect(verifyOutput('python', 'Python 3.9.18', W)).toMatchObject({ status: 'failed', reason: 'python_too_old', found: 'Python 3.9.18' });
    expect(verifyOutput('python', 'Python 2.7.18', M)).toMatchObject({ status: 'failed', reason: 'python_2' });
  });
  it('sends test releases to manual review', () => {
    expect(verifyOutput('python', 'Python 3.14.0rc2', W)).toMatchObject({ status: 'manual_review', reason: 'python_prerelease' });
  });
  it('recognises the Windows Store shortcut and a missing command', () => {
    expect(verifyOutput('python', 'Python was not found; run without arguments to install from the Microsoft Store, or disable this shortcut from Settings > Apps > Advanced app settings > App execution aliases.', W).reason).toBe('python_store_stub');
    expect(verifyOutput('python', "'python' is not recognized as an internal or external command,\noperable program or batch file.", W)).toMatchObject({ status: 'failed', reason: 'not_found' });
    expect(verifyOutput('python', 'zsh: command not found: python3', M).reason).toBe('not_found');
  });
  it('rejects malformed or extra output', () => {
    for (const bad of ['Python 3', 'Python 3.12', 'python 3.12.7', 'Python 3.12.7 is installed', 'Python 3.12.7\nPython 3.11.2', 'Pythonista 3.12.7']) expect(verifyOutput('python', bad, W).status, bad).toBe('failed');
  });
  it('ignores the echoed prompt line', () => {
    expect(verifyOutput('python', 'C:\\proj>python --version\nPython 3.12.7', W).status).toBe('verified');
    expect(verifyOutput('python', '(.venv) PS C:\\proj> python --version\r\nPython 3.12.7\r\n', W).status).toBe('verified');
    expect(verifyOutput('python', 'student@pc:~$ python3 --version\nPython 3.12.3', L).status).toBe('verified');
    expect(verifyOutput('python', 'python --version', W)).toMatchObject({ status: 'failed', reason: 'command_only' });
  });
});

describe('pip', () => {
  it('keeps only the versions, never the path', () => {
    const r = verifyOutput('pip', GOOD.pip, W);
    expect(r).toEqual({ status: 'verified', found: 'pip 24.3.1 (Python 3.12)', reason: 'ok' });
    expect(JSON.stringify(r)).not.toContain('student');
  });
  it('fails when pip is missing or the output is not pip', () => {
    expect(verifyOutput('pip', '/usr/bin/python3: No module named pip', L)).toMatchObject({ status: 'failed', reason: 'pip_missing' });
    expect(verifyOutput('pip', 'pip 24.3.1', W).status).toBe('failed');
    expect(verifyOutput('pip', 'pip version 24', W).status).toBe('failed');
  });
});

describe('venv', () => {
  it('verifies an active .venv', () => {
    expect(verifyOutput('venv', GOOD.venv, W).status).toBe('verified');
    expect(verifyOutput('venv', '/Users/student/proj/.venv/bin/python', M).status).toBe('verified');
  });
  it('fails when Python runs from outside an environment', () => {
    expect(verifyOutput('venv', 'C:\\Users\\student\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe', W).reason).toBe('venv_not_active');
    expect(verifyOutput('venv', '/usr/bin/python', L).reason).toBe('venv_not_active');
    expect(verifyOutput('venv', 'INFO: Could not find files for the given pattern(s).', W).reason).toBe('venv_no_python');
  });
  it('sends an environment with another name to manual review', () => {
    expect(verifyOutput('venv', 'C:\\proj\\myenv\\Scripts\\python.exe', W).status).toBe('manual_review');
    expect(verifyOutput('venv', '/home/student/proj/venv/bin/python', L).status).toBe('manual_review');
  });
  it('checks the right path style for the system', () => {
    expect(verifyOutput('venv', '/home/student/proj/.venv/bin/python', W).status).toBe('failed');
    expect(verifyOutput('venv', GOOD.venv, L).status).toBe('failed');
  });
});

describe('Git', () => {
  it('verifies the three official formats', () => {
    expect(verifyOutput('git', 'git version 2.47.1.windows.1', W).found).toBe('Git 2.47.1');
    expect(verifyOutput('git', 'git version 2.39.5 (Apple Git-154)', M).status).toBe('verified');
    expect(verifyOutput('git', 'git version 2.43.0', L).status).toBe('verified');
  });
  it('fails other output', () => {
    expect(verifyOutput('git', 'xcode-select: note: No developer tools were found, requesting install.', M).reason).toBe('git_xcode');
    expect(verifyOutput('git', 'bash: git: command not found', L).reason).toBe('not_found');
    expect(verifyOutput('git', 'git 2.47.1', W).status).toBe('failed');
  });
});

describe('Visual Studio Code', () => {
  it('needs the version, the 40-character commit and the processor', () => {
    expect(verifyOutput('vscode', GOOD.vscode, W).found).toBe('Visual Studio Code 1.95.3');
    expect(verifyOutput('vscode', '1.95.3\nx64', W).status).toBe('failed');
    expect(verifyOutput('vscode', '1.95.3\nabc123\nx64', W).status).toBe('failed');
  });
});

describe('Python packages', () => {
  it('verifies the labelled version only', () => {
    expect(verifyOutput('numpy', 'numpy 2.1.3', L).found).toBe('NumPy 2.1.3');
    expect(verifyOutput('pandas', 'pandas 3.0.0rc0', W).status).toBe('verified');
    expect(verifyOutput('matplotlib', 'matplotlib 3.10.0.post1', W).status).toBe('verified');
    expect(verifyOutput('scikit-learn', 'scikit-learn 1.7.0', M).found).toBe('scikit-learn 1.7.0');
    expect(verifyOutput('jupyterlab', 'jupyterlab 4.3.4', W).found).toBe('JupyterLab 4.3.4');
  });
  it('fails a missing package with the install step', () => {
    const r = verifyOutput('numpy', 'Traceback (most recent call last):\n  File "<string>", line 1, in <module>\nModuleNotFoundError: No module named \'numpy\'', W);
    expect(r).toMatchObject({ status: 'failed', reason: 'missing_module:numpy' });
    expect(explain(r.reason, 'x').next).toContain('python -m pip install numpy');
  });
  it('does not accept another package or a bare number', () => {
    expect(verifyOutput('numpy', 'pandas 2.2.3', W).status).toBe('failed');
    expect(verifyOutput('pandas', '2.2.3', W).status).toBe('failed');
    expect(verifyOutput('scikit-learn', 'sklearn 1.7.0', W).status).toBe('failed');
  });
});

describe('PyTorch', () => {
  it('verifies GPU and CPU builds', () => {
    expect(verifyOutput('pytorch', 'torch 2.9.0+cu128 cuda True', { os: 'windows', gpu: 'yes' }).found).toBe('PyTorch 2.9.0+cu128, GPU (CUDA) available');
    expect(verifyOutput('pytorch', 'torch 2.9.0 cuda False', { os: 'macos', gpu: 'not_sure' }).status).toBe('verified');
    expect(verifyOutput('pytorch', 'torch 2.9.0+cpu cuda False', { os: 'linux', gpu: 'no' }).status).toBe('verified');
  });
  it('asks for review when an NVIDIA card was reported but CUDA is off', () => {
    expect(verifyOutput('pytorch', 'torch 2.9.0+cpu cuda False', { os: 'windows', gpu: 'yes' })).toMatchObject({ status: 'manual_review', reason: 'torch_no_cuda' });
  });
  it('fails other output', () => {
    expect(verifyOutput('pytorch', '2.9.0\nTrue', W).status).toBe('failed');
    expect(verifyOutput('pytorch', "ModuleNotFoundError: No module named 'torch'", W).reason).toBe('missing_module:torch');
  });
});

describe('NVIDIA', () => {
  it('reads the driver and CUDA versions from nvidia-smi', () => {
    expect(verifyOutput('nvidia-gpu', GOOD['nvidia-gpu'], W).found).toBe('NVIDIA driver 566.14, supports CUDA up to 12.7');
  });
  it('fails without a working driver', () => {
    expect(verifyOutput('nvidia-gpu', "NVIDIA-SMI has failed because it couldn't communicate with the NVIDIA driver. Make sure that the latest NVIDIA driver is installed and running.", L).reason).toBe('nvidia_no_driver');
    expect(verifyOutput('nvidia-gpu', "'nvidia-smi' is not recognized as an internal or external command,", W).reason).toBe('not_found');
    expect(verifyOutput('nvidia-gpu', 'Driver Version: 566.14', W).status).toBe('failed');
  });
  it('has no check on macOS', () => {
    expect(verifyOutput('nvidia-gpu', GOOD['nvidia-gpu'], M)).toMatchObject({ status: 'manual_review', reason: 'no_rule' });
  });
});

describe('input limits and sensitive information', () => {
  it('rejects very long input', () => {
    expect(verifyOutput('python', 'Python 3.12.7\n' + 'x'.repeat(7000), W).reason).toBe('too_long');
  });
  it('finds user paths, emails, addresses and secrets', () => {
    expect(findSensitive('C:\\Users\\student\\proj\\.venv\\Scripts\\python.exe')).toEqual(['user_path']);
    expect(findSensitive('/home/student/proj/.venv/bin/python')).toEqual(['user_path']);
    expect(findSensitive('contact me: student@example.com')).toContain('email');
    expect(findSensitive('server 192.168.1.20 answered')).toContain('ip');
    expect(findSensitive('OPENAI_API_KEY=sk-abcdefghijklmnop1234')).toContain('secret');
    expect(findSensitive('token: abc')).toContain('secret');
    expect(findSensitive('ghp_ABCDEFGHIJKLMNOPQRSTUV123456')).toContain('secret');
  });
  it('does not mistake version numbers for addresses', () => {
    expect(findSensitive('Python 3.12.7')).toEqual([]);
    expect(findSensitive(GOOD['nvidia-gpu'])).toEqual([]);
    expect(findSensitive('torch 2.9.0+cu128 cuda True')).toEqual([]);
  });
  it('blocks output that contains a secret, and never checks it', () => {
    expect(verifyOutput('python', 'Python 3.12.7\npassword=hunter2', W)).toEqual({ status: 'blocked', reason: 'secret' });
  });
  it('still checks output with a user path, but keeps no part of it', () => {
    const r = verifyOutput('venv', GOOD.venv, W);
    expect(r.status).toBe('verified');
    expect(JSON.stringify(r)).not.toMatch(/student|Users/);
  });
  it('gives a next step for every failure reason', () => {
    for (const reason of ['empty', 'too_long', 'secret', 'command_only', 'not_found', 'unrelated', 'no_rule', 'python_store_stub', 'python_2', 'python_too_old', 'python_prerelease', 'pip_missing', 'venv_no_python', 'venv_not_active', 'venv_other_name', 'git_xcode', 'torch_no_cuda', 'nvidia_no_driver', 'missing_module:numpy'])
      expect(explain(reason, 'cmd').next, reason).toBeTruthy();
  });
});

describe('line cleaning', () => {
  it('keeps output lines and drops the command echo', () => {
    expect(cleanLines('C:\\x> git --version\r\n\r\ngit version 2.47.1.windows.1\r\n', 'git --version')).toEqual(['git version 2.47.1.windows.1']);
  });
});
