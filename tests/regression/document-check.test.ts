import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { checkDocument } from '@/lib/check';
import { parseDocx } from '@/lib/docx';
import type { Profile } from '@/lib/types';
import { buildSyntheticThesis } from '../helpers/syntheticThesis';

const profile = JSON.parse(fs.readFileSync('data/profiles/cn-nuist-international-postgraduate-2026.json', 'utf8')) as Profile;

const summary = (r: ReturnType<typeof checkDocument>) => ({
  stats: r.stats,
  results: r.results.map((x) => `${x.ruleId}: ${x.status}: ${x.detail}`),
  audit: r.audit.map((a) => `${a.id}: ${a.ok}: ${a.detail}`),
  conflicts: r.conflicts.map((c) => `${c.id}: ${c.observed ?? '-'}`),
});

describe('document checking behavior', () => {
  it('final mode on a clean document', async () => {
    const d = await parseDocx(await buildSyntheticThesis());
    expect(summary(checkDocument(d, profile, { degree: 'master_academic', mode: 'final' }))).toMatchSnapshot();
  });
  it('blind mode with a name to find', async () => {
    const d = await parseDocx(await buildSyntheticThesis());
    expect(summary(checkDocument(d, profile, { degree: 'master_academic', mode: 'blind', names: ['Candidate Example'] }))).toMatchSnapshot();
  });
  it('final mode on a badly formatted document', async () => {
    const d = await parseDocx(await buildSyntheticThesis({ wrongBodyFont: true }));
    expect(summary(checkDocument(d, profile, { degree: 'doctorate_academic', mode: 'final' }))).toMatchSnapshot();
  });
});
