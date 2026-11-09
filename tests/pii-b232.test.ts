import { afterEach, describe, expect, it, vi } from 'vitest';
import { identityWords, maybePii, redactIdentity, redactPii } from '@/lib/pii';
import { cleanRun, emptyDraft, newRun, redact, withoutIdentity } from '@/lib/runs';
import { evidenceOf, sentenceProblems } from '@/lib/claims';

// B2.3.2: the 24 redaction cases of the B2.3.1 audit, and the record the AI actually receives.
// All names, hosts and numbers are invented. Name redaction is not exhaustive, and is not claimed to be.
const id = (email: string, text: string, name?: string) => redactIdentity(text, identityWords(email, name));

describe('the 24 B2.3.1 redaction cases', () => {
  const cases: [string, string, string][] = [
    // Names
    ['compound name', id('jean-pierre.dupont@example.test', 'Run by Jean-Pierre Dupont'), 'Run by [name]-[name] [name]'],
    ['accented name, ASCII email (missed before)', id('helene.lefevre@example.test', 'Run by Hélène Lefèvre'), 'Run by [name] [name]'],
    ['accented name, accented email', id('hélène.lefèvre@example.test', 'Run by Hélène Lefèvre'), 'Run by [name] [name]'],
    ['short name, from the email only', id('li.wei@example.test', 'Run by Li Wei'), 'Run by Li [name]'],
    ['Chinese name in script, from the display name (missed before)', id('zhang.san@example.test', '张三 ran it', '张三'), '[name] ran it'],
    ['generic email words', id('student.thesis2026@example.test', 'student thesis results'), 'student thesis results'],
    ['name that is a common word (over-removed before)', id('may.rose@example.test', 'Loss rose to 0.3 and may fall'), 'Loss rose to 0.3 and may fall'],
    ['name equal to a metric (over-removed before)', id('dice.chen@example.test', 'Dice 0.81 on test'), 'Dice 0.81 on test'],
    // Network paths and hosts
    ['UNC user folder (tail leaked before)', redactPii('Data at \\\\fileserver\\students\\herve\\data.csv'), 'Data at [network-path]'],
    ['UNC with forward slashes (missed before)', redactPii('Data at //fileserver/students/herve'), 'Data at [network-path]'],
    ['university cluster host (missed before)', redactPii('Ran on gpu03.hpc.nuist.edu.cn'), 'Ran on [host]'],
    ['bare host name', redactPii('Ran on node17 overnight'), 'Ran on node17 overnight'],
    // Phones, serials, IDs
    ['phone with dashes', redactPii('Phone +86-138-0013-8000'), 'Phone [phone]'],
    ['Chinese landline (missed before)', redactPii('Office 025-5873-1234'), 'Office [phone]'],
    ['US phone (missed before)', redactPii('Call (415) 555-0132'), 'Call [phone]'],
    ['disk serial without label (missed before)', redactPii('Disk WD-WCC4N1234567'), 'Disk [serial]'],
    ['Windows SID (missed before)', redactPii('S-1-5-21-3623811015-3361044348-30300820-1013'), '[sid]'],
    // Scientific data that must stay
    ['metric list', redact('accuracy 0.912, F1 0.881, RMSE 12.4, MAE 0,15').text, 'accuracy 0.912, F1 0.881, RMSE 12.4, MAE 0,15'],
    ['big counts', redact('1,234,567 parameters; 13 800 138 000 tokens').text, '1,234,567 parameters; 13 800 138 000 tokens'],
    ['hyperparameter grid (over-removed before)', redact('lr in 0.1 0.01 0.001; epochs 05 10 15 20 25').text, 'lr in 0.1 0.01 0.001; epochs 05 10 15 20 25'],
    ['timestamps', redact('started 12:34:56, finished 13:01:02').text, 'started 12:34:56, finished 13:01:02'],
    ['11-digit sample count (over-removed before)', redact('13800138000 samples').text, '13800138000 samples'],
    ['Windows build number', redact('Windows 10.0.19045.3693').text, 'Windows 10.0.19045.3693'],
    ['checkpoint ID (over-removed before)', redact('commit 1a2b3c4d5e6f checkpoint ab:cd:ef:01:23:45 tag').text, 'commit 1a2b3c4d5e6f checkpoint ab:cd:ef:01:23:45 tag'],
  ];
  it('has all 24 cases', () => expect(cases).toHaveLength(24));
  it.each(cases)('%s', (_area, got, want) => expect(got).toBe(want));
});

describe('boundaries', () => {
  it('still hides clear personal names, also next to a common word', () => {
    expect(id('may.rose@example.test', 'Rose to 0.3. May Rose ran it.')).toBe('Rose to 0.3. [name] [name] ran it.');
    expect(id('dice.chen@example.test', 'Run by Dice Chen, Dice 0.81')).toBe('Run by [name] [name], Dice 0.81');
    expect(id('herve.kom@example.test', 'run by herve and HERVE')).toBe('run by [name] and [name]');
    expect(id('li.wei@example.test', 'Run by Li Wei; li-ion battery', 'Li Wei')).toBe('Run by [name] [name]; li-ion battery');
  });
  it('a metric named like the student is kept in the claim checks', () => {
    const run = withoutIdentity(cleanRun(newRun({ ...emptyDraft(), name: 'x', metrics: [{ name: 'Dice', value: 0.81, split: 'test' }] }, '2026-11-09T10:00:00.000Z', 'run-123456'))!, 'dice.chen@example.test');
    expect(run.metrics[0].name).toBe('Dice');
    expect(sentenceProblems('Dice is 0.81 on test.', evidenceOf(run))).toEqual([]);
  });
  it('phone-like and MAC-like values need a word saying what they are', () => {
    expect(redactPii('Mobile 13800138000')).toBe('Mobile [phone]');
    expect(redactPii('Tél. : 06 12 34 56 78')).toBe('Tél. : [phone]');
    expect(redactPii('wlan0 ether 00:1a:2b:3c:4d:5e')).toBe('wlan0 ether [mac]');
    expect(redactPii('ids 06 12 34 56 78')).toBe('ids 06 12 34 56 78');
    expect(redactPii('hash ab:cd:ef:01:23:45')).toBe('hash ab:cd:ef:01:23:45');
  });
  it('kept look-alikes are flagged so the student can decide', () => {
    expect(maybePii('epochs 05 10 15 20 25')).toBe(true);
    expect(maybePii('checkpoint ab:cd:ef:01:23:45')).toBe(true);
    expect(maybePii('Phone 13800138000')).toBe(false);
    expect(maybePii('accuracy 0.912')).toBe(false);
  });
  it('leaves web addresses, public university sites, model names and local commands alone', () => {
    const keep = ['see https://example.org/a/b and http://x.y/z', 'cs231n.stanford.edu notes', 'ResNet-50, UTF-8, SHA-256, CVE-2024-12345', 'python train.py --data ./data/train.csv --out runs/exp1', 'x = a // 2'];
    for (const k of keep) expect(redact(k).text).toBe(k);
  });
  it('hides network paths in every form, with the folders after the share', () => {
    expect(redactPii('copy \\\\nas01\\lab$\\2026\\herve\\run.log now')).toBe('copy [network-path] now');
    expect(redactPii('mounted smb://nas01/research/herve/data')).toBe('mounted [network-path]');
    expect(redactPii('nfs://storage.lab/export/home/herve')).toBe('[network-path]');
  });
});

describe('the record the AI receives (feedback route)', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
  });
  it('holds no name, path, host, phone, serial or ID, and keeps the scientific values', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.mock';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable-mock';
    process.env.LLM_BASE_URL = 'http://llm.mock/v1';
    process.env.LLM_API_KEY = 'mock-key';
    process.env.LLM_MODEL = 'mock-model';
    let prompt = '';
    vi.stubGlobal('fetch', (async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: '00000000-0000-4000-8000-0000000000aa', email: 'helene.lefevre@example.test', user_metadata: { full_name: 'Hélène Lefèvre 张三' } }));
      prompt = JSON.parse(String(init?.body)).messages.map((x: { content: string }) => x.content).join('\n');
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"summary":"Mock.","can_support":[],"cannot_support":[],"missing":[],"next_action":""}' } }] }));
    }) as typeof fetch);
    const { POST } = await import('@/app/api/runs/feedback/route');
    const run = newRun(
      {
        ...emptyDraft(),
        name: 'Hélène baseline',
        dataset: 'Synthetic, 13800138000 samples',
        settings: 'lr in 0.1 0.01 0.001; epochs 05 10 15 20 25',
        notes: 'Run by Hélène Lefèvre (张三) on gpu03.hpc.nuist.edu.cn. Data at //fileserver/students/helene and \\\\nas01\\share\\helene\\x.csv. Office 025-5873-1234, call (415) 555-0132. Disk WD-WCC4N1234567, S-1-5-21-3623811015-3361044348-30300820-1013. May rose.',
        log: 'checkpoint ab:cd:ef:01:23:45 saved',
        metrics: [{ name: 'Dice', value: 0.81, split: 'test' }, { name: 'accuracy', value: 0.912, split: 'test' }],
      },
      '2026-11-09T10:00:00.000Z',
      'run-123456',
    );
    const res = await POST(new Request('http://app.mock/api/runs/feedback', { method: 'POST', headers: { authorization: 'Bearer mock-token', 'content-type': 'application/json' }, body: JSON.stringify({ run }) }));
    expect(res.status).toBe(200);
    expect(prompt).toContain('<run_record>');
    expect(prompt).not.toMatch(/hélène|helene|lefèvre|lefevre|张三|gpu03|fileserver|nas01|025-5873|555-0132|WCC4N|3623811015/i);
    for (const keep of ['Dice (test) = 0.81', 'accuracy (test) = 0.912', '13800138000 samples', 'epochs 05 10 15 20 25', 'ab:cd:ef:01:23:45', 'May rose.']) expect(prompt).toContain(keep);
    expect(prompt).toContain('[name] baseline');
  });
});
