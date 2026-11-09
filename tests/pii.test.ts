import { describe, expect, it } from 'vitest';
import { findSensitive } from '@/lib/labVerify';
import { identityWords, redactIdentity, redactPii } from '@/lib/pii';
import { runMessages } from '@/lib/runFeedback';
import { cleanRun, emptyDraft, newRun, redact, withoutIdentity } from '@/lib/runs';

// All names, hosts and numbers below are invented.
describe('device and contact details are hidden', () => {
  const cases: [string, string][] = [
    ['Data in \\\\fileserver\\students\\li\\data.csv', 'Data in \\\\[host]\\[share]\\li\\data.csv'],
    ['Mounted smb://nas01/research for the run', 'Mounted smb://[host]/[research] for the run'.replace('[research]', '[share]')],
    ['li@lab-pc:~$ python train.py', '[user]@[host]:~$ python train.py'],
    ['Ran on gpu01.lab.local overnight', 'Ran on [host] overnight'],
    ['Computer DESKTOP-4F7K2QX', 'Computer [host]'],
    ['hostname=node17', 'hostname=[host]'],
    ['user=student login: li.wei', 'user=[user] login: [user]'],
    ['Serial number: 1324019876543', 'Serial number: [serial]'],
    ['GPU 0: RTX (UUID: GPU-12345678-90ab-cdef-1234-567890abcdef)', 'GPU 0: RTX (UUID: [gpu-id])'],
    ['MAC 00:1A:2B:3C:4D:5E', 'MAC [mac]'],
    ['Call me on +86 138 0013 8000', 'Call me on [phone]'],
    ['Phone 13800138000', 'Phone [phone]'],
    // French
    ['Joignable au 06 12 34 56 78', 'Joignable au [phone]'],
    ['utilisateur=etudiant1 sur la machine', 'utilisateur=[user] sur la machine'],
    ['Numéro de série : ABC123456', 'Numéro de série : [serial]'],
    ['nom de l’ordinateur : PC-LABO-07', 'nom de l’ordinateur : [host]'],
  ];
  it.each(cases)('%s', (input, expected) => {
    expect(redactPii(input)).toBe(expected);
    expect(findSensitive(input).length).toBeGreaterThan(0);
  });
});

describe('scientific values are kept', () => {
  const keep = [
    'accuracy 0.912 on test, RMSE 12.4, MAE 0,15',
    'Synthetic data, 12,000 rows, split 70 / 15 / 15',
    'Données synthétiques, 12 000 lignes',
    'Python 3.12.7; PyTorch 2.9.0+cu128; CUDA Version: 12.7',
    'lr 0.001, batch 64, 30 epochs, seed 42, 14 min',
    'Run on 2026-11-09 at 10:30',
    'pip 24.3.1 from site-packages (python 3.12)',
    '| NVIDIA-SMI 566.14   Driver Version: 566.14   CUDA Version: 12.7 | Bus-Id 00000000:01:00.0 |',
    'p < 0.01 with 5 folds; loss 0.231 → 0.198',
    'f1a4fb101478ce6ec82fe9627c43efbf9e98c813',
  ];
  it.each(keep)('%s', (text) => {
    expect(redactPii(text)).toBe(text);
    expect(redact(text).text).toBe(text);
  });
});

describe('the student’s own name', () => {
  it('comes from the account email, without generic words or very short parts', () => {
    expect(identityWords('herve.kom@example.test')).toEqual(['herve', 'kom']);
    expect(identityWords('student2026@example.test')).toEqual([]);
    expect(identityWords('li.wei@example.test')).toEqual(['wei']);
    expect(identityWords(undefined)).toEqual([]);
  });
  it('is replaced as a whole word only', () => {
    expect(redactIdentity('Herve ran it; Hervey did not; kombucha', ['herve', 'kom'])).toBe('[name] ran it; Hervey did not; kombucha');
  });
  it('the AI receives only the cleaned record, without the name, device details or contacts', () => {
    const run = newRun(
      { ...emptyDraft(), name: 'Herve baseline', notes: 'Ran by Herve on DESKTOP-4F7K2QX, call +86 138 0013 8000, user=herve', log: 'herve@lab-pc:~$ python train.py\nserial: 1324019876543', metrics: [{ name: 'accuracy', value: 0.912, split: 'test' }] },
      '2026-11-09T10:00:00.000Z',
      'run-123456',
    );
    const cleaned = withoutIdentity(cleanRun(run)!, 'herve.kom@example.test');
    const sent = runMessages(cleaned)[1].content;
    expect(sent).not.toMatch(/herve|DESKTOP-4F|138 0013|1324019876543|lab-pc/i);
    expect(sent).toContain('accuracy (test) = 0.912');
    expect(sent).toContain('[name] baseline');
  });
});
