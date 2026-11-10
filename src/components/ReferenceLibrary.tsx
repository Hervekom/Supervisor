'use client';
// Phase P6: the student's reference library on the Document page. Only a DOI, a title or an author name is ever sent,
// to Crossref through Supervisor's server; the thesis text never is.
import { useState } from 'react';
import {
  addRef, authorsText, buildBibliography, citationOrder, duplicateOf, formatApa, formatGb, importBibtex, libraryOf, missingFields, parseAuthors,
  removeRef, stateOf, STATE_LABELS, STYLE_LABELS, TYPE_LABELS, updateRef, type CitationStyle, type Draft, type Library, type LibRef, type RefType, type Seg,
} from '@/lib/library';
import type { PathState } from '@/lib/path';
import { doiOf, titleOf } from '@/lib/references';
import { canRetry, errorText, requestAi } from '@/lib/request';
import { structureOf } from '@/lib/structures';

type Form = { type: RefType; key: string; authors: string; title: string; year: string; container: string; volume: string; issue: string; pages: string; publisher: string; place: string; school: string; thesisKind: '' | 'phd' | 'masters'; doi: string; url: string };
const EMPTY: Form = { type: 'article', key: '', authors: '', title: '', year: '', container: '', volume: '', issue: '', pages: '', publisher: '', place: '', school: '', thesisKind: '', doi: '', url: '' };
const toForm = (r: Draft | LibRef): Form => ({ ...EMPTY, ...Object.fromEntries(Object.entries(r).filter(([, v]) => typeof v === 'string')), type: r.type, authors: authorsText(r.authors), thesisKind: r.thesisKind ?? '' } as Form);
const toDraft = (f: Form): Draft => ({ ...f, authors: parseAuthors(f.authors), thesisKind: f.thesisKind || undefined });

export function Segs({ segs }: { segs: Seg[] }) {
  return <>{segs.map((s, i) => (s.italic ? <i key={i}>{s.text}</i> : <span key={i}>{s.text}</span>))}</>;
}

/** Inserts [@key] at the cursor of the open part's text box. */
export function CiteSelect({ path, onInsert }: { path: PathState; onInsert: (key: string) => void }) {
  const refs = libraryOf(path).refs;
  if (!refs.length) return <p className="hint">To cite, add references to your library below, then choose one here.</p>;
  return (
    <div className="field" style={{ marginTop: 6 }}>
      <label htmlFor="cite-pick">Insert a citation</label>
      <select id="cite-pick" value="" onChange={(e) => { if (e.target.value) onInsert(e.target.value); }}>
        <option value="">Choose a reference…</option>
        {refs.map((r) => <option key={r.id} value={r.key}>{`[@${r.key}] ${r.title.slice(0, 70)}`}</option>)}
      </select>
      <p className="hint">The citation is added where your cursor is, as [@key]. In the Word file it appears in your chosen style.</p>
    </div>
  );
}

export function ReferenceLibrary({ path, edit, ruleNote }: { path: PathState; edit: (fn: (p: PathState) => PathState) => void; ruleNote?: string }) {
  const lib = libraryOf(path);
  const style: CitationStyle = lib.style ?? 'apa7';
  const setLib = (fn: (l: Library) => Library) => edit((p) => ({ ...p, library: fn(libraryOf(p)) }));
  const texts = structureOf(path).parts.filter((x) => x.id !== 'references').map((x) => path.parts?.[x.id] ?? '');
  const order = citationOrder(texts);
  const bib = buildBibliography(lib, texts, style);
  const uses = (key: string) => texts.reduce((n, t) => n + [...t.matchAll(new RegExp(`@${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[\\];,\\s])`, 'g'))].length, 0);

  const [field, setField] = useState<'doi' | 'title' | 'author'>('doi');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<Draft[] | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [editing, setEditing] = useState('');
  const [dupWarn, setDupWarn] = useState<LibRef | null>(null);
  const [bibtex, setBibtex] = useState('');
  const [importNote, setImportNote] = useState('');
  const [confirmDelete, setConfirmDelete] = useState('');
  const [note, setNote] = useState('');

  async function search(f = field, q = query) {
    setBusy(true);
    setError('');
    setRetry(false);
    setFound(null);
    try {
      const j = await requestAi<{ candidates: Draft[] }>('/api/references/lookup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(f === 'doi' ? { doi: q } : { query: q, field: f }) });
      setFound(j.candidates);
    } catch (x) {
      setError(errorText(x));
      setRetry(canRetry(x));
    } finally {
      setBusy(false);
    }
  }

  function addFound(d: Draft) {
    setLib((l) => addRef(l, d, 'crossref'));
    setNote(`Added “${d.title.slice(0, 60)}” from Crossref.`);
  }

  function save(force = false) {
    if (!form) return;
    const d = toDraft(form);
    if (!d.title.trim()) return setError('Add at least a title.');
    const dup = duplicateOf(d, lib.refs, editing || undefined);
    if (dup && !force) return setDupWarn(dup);
    setLib((l) => (editing ? updateRef(l, editing, d) : addRef(l, d, 'manual')));
    setNote(editing ? 'Reference saved.' : 'Reference added.');
    setForm(null);
    setEditing('');
    setDupWarn(null);
    setError('');
  }

  function runImport() {
    const r = importBibtex(lib, bibtex);
    if (!r.added.length && !r.duplicates.length) {
      setImportNote(r.skipped ? 'No entry could be read. Check that the text is BibTeX, starting with @article{…}, @book{…} and so on.' : 'No BibTeX entry was found.');
      return;
    }
    setLib(() => r.library);
    setImportNote([
      `${r.added.length} added${r.added.some((x) => missingFields(x).length) ? `, ${r.added.filter((x) => missingFields(x).length).length} of them incomplete` : ''}.`,
      r.duplicates.length ? `${r.duplicates.length} already in your library, not added again: ${r.duplicates.map((d) => `${d.entry} (as [@${d.of.key}])`).join(', ')}.` : '',
      r.skipped ? `${r.skipped} damaged ${r.skipped === 1 ? 'entry was' : 'entries were'} skipped.` : '',
    ].filter(Boolean).join(' '));
    setBibtex('');
  }

  const typed = (path.parts?.references ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const f = form;
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((x) => (x ? { ...x, [k]: e.target.value } : x));
  const input = (k: keyof Form, label: string, hint?: string) => (
    <div className="field">
      <label htmlFor={`ref-${k}`}>{label}</label>
      <input id={`ref-${k}`} value={f?.[k] ?? ''} onChange={set(k)} />
      {hint ? <p className="hint">{hint}</p> : null}
    </div>
  );

  return (
    <div className="sheet" style={{ marginTop: 16 }} id="library" aria-label="Reference library">
      <h2>Reference library</h2>
      <p className="hint">Your sources, with their details. Cite them in your text with [@key]; the Word file then formats the citations and the reference list in one style. Supervisor never invents a missing detail.</p>
      <div className="field" style={{ marginTop: 10 }}>
        <label htmlFor="cite-style">Citation style</label>
        <select id="cite-style" value={style} onChange={(e) => setLib((l) => ({ ...l, style: e.target.value as CitationStyle }))}>
          {(Object.keys(STYLE_LABELS) as CitationStyle[]).map((k) => <option key={k} value={k}>{STYLE_LABELS[k]}</option>)}
        </select>
        {ruleNote ? <p className="hint">{ruleNote}</p> : null}
      </div>

      <section className="group">
        <h3>Find a publication in Crossref</h3>
        <div className="compare-pick">
          <div className="field">
            <label htmlFor="ref-field">Search by</label>
            <select id="ref-field" value={field} onChange={(e) => setField(e.target.value as typeof field)}>
              <option value="doi">DOI</option><option value="title">Title</option><option value="author">Author</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="ref-query">{field === 'doi' ? 'DOI' : field === 'title' ? 'Title words' : 'Author name'}</label>
            <input id="ref-query" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={field === 'doi' ? '10.1000/xyz123' : ''} onKeyDown={(e) => { if (e.key === 'Enter' && query.trim()) search(); }} />
          </div>
        </div>
        <div className="ask"><button type="button" className="btn ghost" disabled={busy || !query.trim()} onClick={() => search()}>{busy ? 'Searching…' : 'Search'}</button></div>
        <p className="hint">Only what you type here is sent to Crossref. Books, Chinese journals and theses are often missing: add those by hand.</p>
        {error ? <p className="error" role="alert">{error}{retry ? <> <button type="button" className="linklike" onClick={() => search()}>Try again</button></> : null}</p> : null}
        {found ? (
          found.length ? (
            <ul className="todo" aria-label="Crossref results">
              {found.map((d, i) => {
                const dup = duplicateOf(d, lib.refs);
                return (
                  <li key={i}>
                    <Segs segs={(style === 'apa7' ? formatApa : formatGb)({ ...d, id: '', key: '', source: 'crossref', createdAt: '', updatedAt: '' })} />
                    {missingFields({ ...d, id: '', key: '', source: 'crossref', createdAt: '', updatedAt: '' }).length ? <span className="tag"> Crossref lacks: {missingFields({ ...d, id: '', key: '', source: 'crossref', createdAt: '', updatedAt: '' }).join(', ')}</span> : null}{' '}
                    {dup ? <span className="tag">Already in your library as [@{dup.key}]</span> : <button type="button" className="linklike" onClick={() => addFound(d)}>Add to library</button>}
                  </li>
                );
              })}
            </ul>
          ) : <p className="hint">Crossref found nothing for this search. You can add the reference by hand.</p>
        ) : null}
      </section>

      <section className="group">
        <h3>Add or import</h3>
        <div className="ask">
          <button type="button" className="btn ghost" onClick={() => { setForm({ ...EMPTY }); setEditing(''); setDupWarn(null); }}>Add a reference by hand</button>
        </div>
        {f ? (
          <div className="form" style={{ marginTop: 10 }} aria-label={editing ? 'Edit reference' : 'New reference'}>
            <div className="field">
              <label htmlFor="ref-type">Type</label>
              <select id="ref-type" value={f.type} onChange={set('type')}>{(Object.keys(TYPE_LABELS) as RefType[]).map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}</select>
            </div>
            <div className="field">
              <label htmlFor="ref-authors">Authors</label>
              <textarea id="ref-authors" rows={2} value={f.authors} onChange={set('authors')} />
              <p className="hint">Separate authors with “;”. Write “Family, Given” (Smith, John) or the full name in Chinese (王小明).</p>
            </div>
            {input('title', 'Title')}
            <div className="two">{input('year', 'Year')}{input('container', f.type === 'article' ? 'Journal' : f.type === 'web' ? 'Website' : 'Book or proceedings')}</div>
            <div className="two">{input('volume', 'Volume')}{input('issue', 'Issue')}</div>
            <div className="two">{input('pages', 'Pages')}{input('publisher', 'Publisher')}</div>
            <div className="two">{input('place', 'Place of publication')}{f.type === 'thesis' ? input('school', 'University') : input('url', 'Web address')}</div>
            {f.type === 'thesis' ? (
              <div className="field">
                <label htmlFor="ref-kind">Degree</label>
                <select id="ref-kind" value={f.thesisKind} onChange={set('thesisKind')}><option value="">Not stated</option><option value="phd">Doctoral</option><option value="masters">Master’s</option></select>
              </div>
            ) : null}
            <div className="two">{input('doi', 'DOI')}{input('key', 'Citation key', 'Left empty, it is made from the first author and year.')}</div>
            {dupWarn ? (
              <p className="notice" role="alert">This looks like a reference already in your library: [@{dupWarn.key}] {dupWarn.title}. <button type="button" className="linklike" onClick={() => save(true)}>Save it anyway</button></p>
            ) : null}
            <div className="ask">
              <button type="button" className="btn" onClick={() => save()}>{editing ? 'Save changes' : 'Add to library'}</button>
              <button type="button" className="btn ghost" onClick={() => { setForm(null); setEditing(''); setDupWarn(null); }}>Cancel</button>
            </div>
          </div>
        ) : null}
        <details style={{ marginTop: 10 }}>
          <summary>Import BibTeX</summary>
          <div className="field" style={{ marginTop: 6 }}>
            <label htmlFor="ref-bibtex">BibTeX entries</label>
            <textarea id="ref-bibtex" rows={6} value={bibtex} onChange={(e) => setBibtex(e.target.value)} placeholder="@article{smith2024, author = {Smith, John}, title = {…}, journal = {…}, year = {2024}}" />
            <input type="file" accept=".bib,.txt,text/plain" aria-label="Choose a .bib file" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setBibtex(await file.text()); e.target.value = ''; }} />
            <p className="hint">From Zotero, EndNote, Google Scholar or CNKI. Entries already in your library are not added twice. The file is read in this browser.</p>
          </div>
          <div className="ask"><button type="button" className="btn ghost" disabled={!bibtex.trim()} onClick={runImport}>Import</button></div>
          {importNote ? <p className="hint ok" role="status">{importNote}</p> : null}
        </details>
      </section>

      {note ? <p className="hint ok" role="status">{note}</p> : null}

      <section className="group">
        <h3>Your references ({lib.refs.length})</h3>
        {lib.refs.length ? (
          <>
            <p className="hint">{order.length ? `Your text cites ${bib.cited.length} of them${bib.missingKeys.length ? `; ${bib.missingKeys.length} citation key${bib.missingKeys.length === 1 ? ' matches' : 's match'} nothing: ${bib.missingKeys.map((k) => `[@${k}]`).join(', ')}` : ''}.` : 'Your text cites none of them yet.'}</p>
            <ul className="todo" aria-label="Library references">
              {lib.refs.map((r) => {
                const missing = missingFields(r);
                const dup = duplicateOf(r, lib.refs, r.id);
                const n = uses(r.key);
                return (
                  <li key={r.id} data-testid="lib-ref">
                    <p><code>[@{r.key}]</code> <span className="tag">{STATE_LABELS[stateOf(r)]}</span>{missing.length ? <span className="tag blocking"> Incomplete: {missing.join(', ')}</span> : null}{dup ? <span className="tag blocking"> Possible duplicate of [@{dup.key}]</span> : null}{n ? <span className="tag"> Cited {n}×</span> : null}</p>
                    <p><Segs segs={style === 'apa7' ? formatApa(r) : formatGb(r)} /></p>
                    <p className="ask" style={{ marginTop: 4 }}>
                      <button type="button" className="linklike" onClick={() => { setForm(toForm(r)); setEditing(r.id); setDupWarn(null); }}>Edit</button>
                      {confirmDelete === r.id ? (
                        <>
                          <span className="hint">{n ? `It is cited ${n}× in your text; those citations will show as missing.` : ''}</span>
                          <button type="button" className="linklike" onClick={() => { setLib((l) => removeRef(l, r.id)); setConfirmDelete(''); }}>Delete for good</button>
                          <button type="button" className="linklike" onClick={() => setConfirmDelete('')}>Keep it</button>
                        </>
                      ) : <button type="button" className="linklike" aria-label={`Delete [@${r.key}]`} onClick={() => setConfirmDelete(r.id)}>Delete</button>}
                    </p>
                  </li>
                );
              })}
            </ul>
          </>
        ) : <p className="hint">No references yet.</p>}
      </section>

      {typed.length ? (
        <details style={{ marginTop: 10 }}>
          <summary>References you typed in the References part ({typed.length})</summary>
          <p className="hint">They are kept exactly as typed. To add one to your library, look it up in Crossref or add it by hand; the typed line is not changed.</p>
          <ul className="todo" aria-label="Typed references">
            {typed.map((line, i) => (
              <li key={i}>{line} <button type="button" className="linklike" onClick={() => { const d = doiOf(line); const q = d ?? titleOf(line); setField(d ? 'doi' : 'title'); setQuery(q); search(d ? 'doi' : 'title', q); }}>Find in Crossref</button></li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
