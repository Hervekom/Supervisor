import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { auditEntry, guessOs, isOfficialUrl, selectTools, type Software } from '@/lib/software';
import { loadCatalogue, validateCatalogue } from '@/lib/softwareCatalog';

const catalogue = loadCatalogue();
const files = fs.readdirSync('data/software').filter((f) => f.endsWith('.json'));
const raw = (id: string) => JSON.parse(fs.readFileSync(`data/software/${id}.json`, 'utf8')) as Software;
const check = (data: unknown, file = 'x.json') => validateCatalogue([{ file, data }]);
const ids = (t: Software[]) => t.map((x) => x.id);

describe('software catalogue', () => {
  it('has the seventeen reviewed entries, all valid', () => {
    expect(validateCatalogue(files.map((file) => ({ file, data: JSON.parse(fs.readFileSync(`data/software/${file}`, 'utf8')) }))).errors).toEqual([]);
    expect(ids(catalogue)).toEqual(['python', 'pip', 'venv', 'git', 'vscode', 'jupyterlab', 'numpy', 'pandas', 'matplotlib', 'scikit-learn', 'scipy', 'statsmodels', 'pytorch', 'nvidia-gpu', 'r', 'rstudio', 'taguette']);
  });
  it('records a review date and official sources for every entry', () => {
    for (const e of catalogue) {
      expect(e.last_reviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.sources.length).toBeGreaterThan(0);
    }
  });
  it('rejects a missing field', () => {
    const { purpose: _, ...rest } = raw('numpy');
    expect(check(rest, 'numpy.json').ok).toBe(false);
  });
  it('rejects an unknown system', () => {
    expect(check({ ...raw('numpy'), os: ['windows', 'android'] }, 'numpy.json').ok).toBe(false);
  });
  it('rejects a duplicate id and a file name that does not match', () => {
    const e = raw('numpy');
    expect(validateCatalogue([{ file: 'numpy.json', data: e }, { file: 'numpy.json', data: e }]).errors.join()).toContain('duplicate id');
    expect(check(e, 'other.json').errors.join()).toContain('does not match');
  });
  it('rejects a supported system with no installation instructions', () => {
    const e = raw('git');
    const { linux: _, ...install } = e.install;
    expect(auditEntry({ ...e, install }, new Set(ids(catalogue)))).toContain('git: no installation instructions for linux');
  });
  it('rejects a supported system with no verification command', () => {
    const e = raw('git');
    const { macos: _, ...verify } = e.verify;
    expect(auditEntry({ ...e, verify }, new Set(ids(catalogue)))).toContain('git: no verification command for macos');
  });
  it('rejects instructions for a system the tool does not support', () => {
    const e = raw('nvidia-gpu');
    expect(auditEntry({ ...e, install: { ...e.install, macos: [{ text: 'Do something here' }] } }, new Set(ids(catalogue))).join()).toContain('which it does not support');
  });
  it('rejects multi-line commands', () => {
    const e = raw('git');
    expect(check({ ...e, verify: { ...e.verify, linux: { command: 'git --version\nrm -rf ~', expected: 'x y z' } } }, 'git.json').ok).toBe(false);
  });
  it('rejects unknown prerequisites', () => {
    expect(auditEntry({ ...raw('numpy'), prerequisites: ['nothing'] }, new Set(ids(catalogue)))).toContain('numpy: unknown prerequisite nothing');
  });
});

describe('official domain allow-list', () => {
  it.each([
    ['https://www.python.org/downloads/', true],
    ['https://pytorch.org/get-started/locally/', true],
    ['https://docs.nvidia.com/cuda/', true],
    ['http://www.python.org/downloads/', false],
    ['https://python.org.example.com/', false],
    ['https://evil-python.org/', false],
    ['https://www.python.org@evil.com/', false],
    ['https://www.python.org:8443/', false],
    ['https://pypi-mirror.cn/simple', false],
    ['javascript:alert(1)', false],
    ['not a url', false],
  ])('%s → %s', (url, ok) => {
    expect(isOfficialUrl(url)).toBe(ok);
  });
  it('rejects an entry with an unofficial link', () => {
    expect(check({ ...raw('numpy'), official_download_url: 'https://numpy-downloads.example.com/' }, 'numpy.json').errors.join()).toContain('not an allowed official');
  });
});

describe('filtering', () => {
  const base = { os: 'windows' as const, gpu: 'not_sure' as const };
  it('shows nothing until a work type and a system are chosen', () => {
    expect(selectTools(catalogue, { ...base, workTypes: [] })).toEqual([]);
    expect(selectTools(catalogue, { workTypes: ['machine_learning'], os: null, gpu: 'no' })).toEqual([]);
  });
  it('Python programming gets only the shared tools', () => {
    expect(ids(selectTools(catalogue, { ...base, workTypes: ['python'] }))).toEqual(['python', 'pip', 'venv', 'git', 'vscode']);
  });
  it('statistics does not get deep learning tools', () => {
    const t = ids(selectTools(catalogue, { ...base, workTypes: ['statistics'] }));
    expect(t).toEqual(expect.arrayContaining(['pandas', 'matplotlib', 'jupyterlab']));
    expect(t).not.toContain('pytorch');
    expect(t).not.toContain('scikit-learn');
  });
  it('deep learning adds PyTorch, and GPU guidance only when it may apply', () => {
    expect(ids(selectTools(catalogue, { ...base, workTypes: ['deep_learning'], gpu: 'yes' }))).toEqual(expect.arrayContaining(['pytorch', 'nvidia-gpu']));
    expect(ids(selectTools(catalogue, { ...base, workTypes: ['deep_learning'], gpu: 'no' }))).not.toContain('nvidia-gpu');
    expect(ids(selectTools(catalogue, { ...base, workTypes: ['deep_learning'], gpu: 'not_sure' }))).toContain('nvidia-gpu');
  });
  it('macOS never gets the NVIDIA card', () => {
    expect(ids(selectTools(catalogue, { workTypes: ['deep_learning'], os: 'macos', gpu: 'yes' }))).not.toContain('nvidia-gpu');
  });
  it('each tool appears once in a fixed order when work types overlap', () => {
    const t = ids(selectTools(catalogue, { ...base, workTypes: ['machine_learning', 'data_science', 'nlp'] }));
    expect(new Set(t).size).toBe(t.length);
    expect(t.indexOf('python')).toBe(0);
  });
});

describe('system guess', () => {
  it.each([
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'windows'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'macos'],
    ['Mozilla/5.0 (X11; Linux x86_64)', 'linux'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel)', null],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', null],
  ])('%s', (ua, os) => {
    expect(guessOs(ua)).toBe(os);
  });
});
