import { describe, expect, it } from 'vitest';
import { lookupCrossref } from '@/lib/crossref';
import {
  addRef, buildBibliography, citationOrder, crossrefToDraft, duplicateOf, formatApa, formatGb, importBibtex, libraryOf, missingFields, parseAuthors,
  parseBibtex, removeRef, segText, stateOf, updateRef, type Draft, type Library,
} from '@/lib/library';
import { emptyPath } from '@/lib/path';

// Phase P6: reference library. All references are synthetic.
const NOW = '2026-11-10T07:00:00.000Z';
const smith: Draft = { type: 'article', title: 'A lantern method for fictional networks', authors: [{ family: 'Smith', given: 'John Adam' }, { family: 'Lee', given: 'Kim' }], year: '2024', container: 'Journal of Lanterns', volume: '12', issue: '3', pages: '45–67', doi: '10.1234/LANTERN.2024.001' };
const wang: Draft = { type: 'article', title: '灯笼方法在虚构网络中的应用', authors: [{ literal: '王小明' }, { literal: '李华' }, { literal: '张伟' }, { literal: '赵六' }], year: '2025', container: '虚构计算机学报', volume: '48', issue: '2', pages: '101–110' };
const book: Draft = { type: 'book', title: 'Fictional deep learning', authors: [{ family: 'Brown', given: 'Ana' }], year: '2023', publisher: 'Example Press', place: 'Nanjing' };
const lib = (...ds: [Draft, 'manual' | 'crossref' | 'bibtex'][]): Library => ds.reduce((l, [d, s], i) => addRef(l, d, s, NOW, `id${i}`), { refs: [] } as Library);

describe('library records', () => {
  it('older saved copies have an empty library', () => {
    expect(libraryOf(emptyPath())).toEqual({ style: undefined, refs: [] });
  });
  it('keys, sources and states', () => {
    const l = lib([smith, 'crossref'], [wang, 'manual'], [{ ...smith, doi: undefined, title: 'Another 2024 paper' }, 'bibtex']);
    expect(l.refs.map((r) => r.key)).toEqual(['smith2024', '王小明2025', 'smith2024a']);
    expect(l.refs.map(stateOf)).toEqual(['verified', 'manual', 'bibtex']);
    expect(l.refs[0].doi).toBe('10.1234/lantern.2024.001');
    expect(l.refs[0].verifiedAt).toBe(NOW);
  });
  it('editing a Crossref record marks it as edited; the key stays', () => {
    const l = lib([smith, 'crossref']);
    const u = updateRef(l, 'id0', { ...smith, pages: '45–68' }, NOW);
    expect([stateOf(u.refs[0]), u.refs[0].key, u.refs[0].pages]).toEqual(['verified_edited', 'smith2024', '45–68']);
    expect(stateOf(updateRef(l, 'id0', smith, NOW).refs[0])).toBe('verified'); // saving without change
    expect(removeRef(u, 'id0').refs).toEqual([]);
  });
  it('incomplete references say what is missing, nothing is filled in', () => {
    const l = lib([{ type: 'article', title: 'Untitled draft paper', authors: [] }, 'manual']);
    expect(missingFields(l.refs[0])).toEqual(['authors', 'journal or book', 'year']);
    expect(l.refs[0].year).toBeUndefined();
  });
  it('duplicates: same DOI in any case or URL form, or same title, year and first author', () => {
    const l = lib([smith, 'crossref']);
    expect(duplicateOf({ ...book, doi: 'https://doi.org/10.1234/lantern.2024.001' }, l.refs)?.id).toBe('id0');
    expect(duplicateOf({ ...smith, doi: undefined, title: 'A LANTERN method, for fictional networks!' }, l.refs)?.id).toBe('id0');
    expect(duplicateOf({ ...smith, doi: undefined, year: '2023' }, l.refs)).toBeUndefined();
  });
  it('author lists: "Family, Given", "Given Family" and Chinese names', () => {
    expect(parseAuthors('Smith, John; Kim Lee; 王小明; {World Health Organization}')).toEqual([{ family: 'Smith', given: 'John' }, { family: 'Lee', given: 'Kim' }, { literal: '王小明' }, { literal: 'World Health Organization' }]);
  });
});

describe('BibTeX', () => {
  const BIB = `
% a comment
@string{jl = "Journal of Lanterns"}
@article{smith2024,
  author = {Smith, John Adam and Kim Lee},
  title = {A {Lantern} Method for Fictional Networks},
  journal = {Journal of Lanterns}, year = 2024, volume = {12}, number = {3}, pages = {45--67},
  doi = {10.1234/lantern.2024.001}
}
@article{wang2025, author = {王小明 and 李华}, title = {灯笼方法在虚构网络中的应用}, journal = {虚构计算机学报}, year = {2025}}
@phdthesis{garcia2022, author = "Garc{\\'i}a, Mar{\\'i}a", title = "Fictional lanterns", school = "Example University", year = "2022"}
@misc{broken
@book{nodate, author = {Brown, Ana}, title = {Fictional deep learning}, publisher = {Example Press}}
`;
  it('reads entries, nested braces, accents, Chinese names and types', () => {
    const { entries, skipped } = parseBibtex(BIB);
    expect(entries.map((e) => e.key)).toEqual(['smith2024', 'wang2025', 'garcia2022', 'nodate']);
    expect(skipped).toBe(1); // the damaged @misc entry
    const r = importBibtex({ refs: [] }, BIB, NOW);
    const [s, w, g, n] = r.library.refs;
    expect(s).toMatchObject({ key: 'smith2024', title: 'A Lantern Method for Fictional Networks', authors: [{ family: 'Smith', given: 'John Adam' }, { family: 'Lee', given: 'Kim' }], pages: '45–67', issue: '3', source: 'bibtex' });
    expect(w.authors).toEqual([{ literal: '王小明' }, { literal: '李华' }]);
    expect(g).toMatchObject({ type: 'thesis', thesisKind: 'phd', school: 'Example University', authors: [{ family: 'García', given: 'María' }] });
    expect(n.year).toBeUndefined();
    expect(missingFields(n)).toEqual(['year']);
  });
  it('an entry already in the library is not added twice, and is listed', () => {
    const first = importBibtex({ refs: [] }, BIB, NOW);
    const again = importBibtex(first.library, BIB, NOW);
    expect(again.added).toHaveLength(0);
    expect(again.duplicates.map((d) => d.of.key)).toEqual(['smith2024', 'wang2025', 'garcia2022', 'nodate']);
    expect(again.library.refs).toHaveLength(4);
  });
});

describe('Crossref', () => {
  const work = { type: 'journal-article', title: ['A lantern method <i>for</i> fictional networks'], 'container-title': ['Journal of Lanterns'], author: [{ family: 'Smith', given: 'John Adam' }, { name: 'Lantern Consortium' }], issued: { 'date-parts': [[2024, 3]] }, volume: '12', issue: '3', page: '45-67', publisher: 'Example', DOI: '10.1234/LANTERN.2024.001', URL: 'https://doi.org/10.1234/lantern.2024.001' };
  it('maps a record; missing fields stay missing', () => {
    expect(crossrefToDraft(work)).toMatchObject({ type: 'article', title: 'A lantern method for fictional networks', authors: [{ family: 'Smith', given: 'John Adam' }, { literal: 'Lantern Consortium' }], year: '2024', pages: '45–67', doi: '10.1234/lantern.2024.001' });
    const bare = crossrefToDraft({ type: 'book', title: ['只有标题的书'] });
    expect(bare).toMatchObject({ type: 'book', title: '只有标题的书', authors: [] });
    expect(bare.year).toBeUndefined();
    expect(bare.publisher).toBeUndefined();
  });
  const respond = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  it('DOI lookup, invalid DOI, unknown DOI, network failure, and search', async () => {
    let asked = '';
    const ok = (async (u: string) => { asked = u; return new Response(JSON.stringify({ message: work })); }) as unknown as typeof fetch;
    const r = await lookupCrossref({ doi: 'https://doi.org/10.1234/LANTERN.2024.001' }, ok, '');
    expect('candidates' in r && r.candidates[0].title).toBe('A lantern method for fictional networks');
    expect(asked).toBe('https://api.crossref.org/works/10.1234%2Flantern.2024.001');
    expect(await lookupCrossref({ doi: 'lantern-2024' }, ok, '')).toMatchObject({ code: 'invalid_doi', retryable: false });
    expect(await lookupCrossref({ doi: '10.1234/missing' }, respond(404, {}), '')).toMatchObject({ code: 'doi_not_found', retryable: false });
    expect(await lookupCrossref({ doi: '10.1234/x' }, (async () => { throw new TypeError('down'); }) as unknown as typeof fetch, '')).toMatchObject({ code: 'unreachable', retryable: true });
    expect(await lookupCrossref({ doi: '10.1234/x' }, respond(503, {}), '')).toMatchObject({ code: 'provider_down', retryable: true });
    const s = await lookupCrossref({ query: '灯笼 方法', field: 'title' }, (async (u: string) => { asked = u; return new Response(JSON.stringify({ message: { items: [work, { type: 'book', title: ['只有标题的书'] }] } })); }) as unknown as typeof fetch, '');
    expect('candidates' in s && s.candidates).toHaveLength(2);
    expect(asked).toContain('query.bibliographic=%E7%81%AF%E7%AC%BC%20%E6%96%B9%E6%B3%95');
    await lookupCrossref({ query: 'Smith', field: 'author' }, ok, '');
    expect(asked).toContain('query.author=Smith');
  });
});

describe('APA 7 and GB/T 7714', () => {
  const l = lib([smith, 'crossref'], [wang, 'manual'], [book, 'manual'], [{ type: 'thesis', title: 'Fictional lanterns', authors: [{ family: 'García', given: 'María' }], year: '2022', school: 'Example University', thesisKind: 'phd' }, 'bibtex']);
  const [s, w, b, t] = l.refs;
  it('APA 7 reference entries, with italics where APA puts them', () => {
    expect(segText(formatApa(s))).toBe('Smith, J. A., & Lee, K. (2024). A lantern method for fictional networks. Journal of Lanterns, 12(3), 45–67. https://doi.org/10.1234/lantern.2024.001');
    expect(formatApa(s).filter((x) => x.italic).map((x) => x.text)).toEqual(['Journal of Lanterns', '12']);
    expect(segText(formatApa(w))).toBe('王小明, 李华, 张伟, & 赵六. (2025). 灯笼方法在虚构网络中的应用. 虚构计算机学报, 48(2), 101–110.');
    expect(segText(formatApa(b))).toBe('Brown, A. (2023). Fictional deep learning. Example Press.');
    expect(segText(formatApa(t))).toBe('García, M. (2022). Fictional lanterns [Doctoral dissertation, Example University].');
    expect(segText(formatApa({ ...b, year: undefined }))).toContain('(n.d.)');
  });
  it('GB/T 7714 numeric entries, in English and Chinese', () => {
    expect(segText(formatGb(s))).toBe('SMITH J A, LEE K. A lantern method for fictional networks[J]. Journal of Lanterns, 2024, 12(3): 45–67. DOI: 10.1234/lantern.2024.001.');
    expect(segText(formatGb(w))).toBe('王小明, 李华, 张伟, 等. 灯笼方法在虚构网络中的应用[J]. 虚构计算机学报, 2025, 48(2): 101–110.');
    expect(segText(formatGb(b))).toBe('BROWN A. Fictional deep learning[M]. Nanjing: Example Press, 2023.');
    expect(segText(formatGb(t))).toBe('GARCÍA M. Fictional lanterns[D]. Example University, 2022.');
  });
  it('citations follow the bibliography: APA author–date, GB/T numbered by first appearance', () => {
    const texts = ['As shown [@王小明2025] and [@smith2024, p. 5].', 'Later [@brown2023; @smith2024] and [@unknown2020].'];
    expect(citationOrder(texts)).toEqual(['王小明2025', 'smith2024', 'brown2023', 'unknown2020']);
    const apa = buildBibliography(l, texts, 'apa7');
    expect(apa.render('[@王小明2025]').text).toBe('(王小明等, 2025)');
    expect(apa.render('[@smith2024, p. 5]').text).toBe('(Smith & Lee, 2024, p. 5)');
    expect(apa.render('[@brown2023; @smith2024]').text).toBe('(Brown, 2023; Smith & Lee, 2024)');
    expect(apa.render('[@unknown2020]')).toEqual({ text: '[@unknown2020]', superscript: false, missing: ['unknown2020'] });
    expect(apa.entries.map((e) => e.ref.key)).toEqual(['brown2023', 'smith2024', '王小明2025']);
    expect(apa.uncited.map((r) => r.key)).toEqual(['garcia2022']); // keys drop accents
    expect(apa.missingKeys).toEqual(['unknown2020']);
    const gb = buildBibliography(l, texts, 'gbt7714');
    expect(gb.render('[@王小明2025]')).toMatchObject({ text: '[1]', superscript: true });
    expect(gb.render('[@brown2023; @smith2024]').text).toBe('[2, 3]');
    expect(gb.entries.map((e) => `${e.label} ${e.ref.key}`)).toEqual(['[1] 王小明2025', '[2] smith2024', '[3] brown2023']);
  });
  it('APA adds a and b for the same author and year', () => {
    const two = addRef(lib([smith, 'manual']), { ...smith, doi: undefined, title: 'Zeta lanterns' }, 'manual', NOW, 'z');
    const bib = buildBibliography(two, ['[@smith2024] [@smith2024a]'], 'apa7');
    expect([bib.render('[@smith2024]').text, bib.render('[@smith2024a]').text]).toEqual(['(Smith & Lee, 2024a)', '(Smith & Lee, 2024b)']);
  });
});
