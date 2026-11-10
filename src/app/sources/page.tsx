'use client';
// Phase P7: the student's research documents. Files are read in this browser; only extracted text, page numbers and
// sections are kept, in this browser. Nothing is sent anywhere unless the student asks the AI about chosen passages.
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccount } from '@/components/useAccount';
import { put } from '@/components/useProfiles';
import { usePathSync } from '@/components/usePathSync';
import { useSourceDocs } from '@/components/useSourceDocs';
import { analyse, CATEGORY_LABELS, closeness, excerpt, search, where, type Analysis, type Category, type Closeness, type DocMeta, type Hit } from '@/lib/docAnalysis';
import { DocProblem, extractFile, MAX_DOC_BYTES } from '@/lib/docExtract';
import { deleteDoc, effectiveMeta, MAX_DOCS, MAX_TOTAL_CHARS, saveDoc, storageEstimate, storeIsPersistent, StoreFullError, type SourceDoc } from '@/lib/docStore';
import { addRef, duplicateOf, libraryOf, parseAuthors, type Draft } from '@/lib/library';
import { count } from '@/lib/limits';
import { emptyPath, isPathState, type PathState } from '@/lib/path';
import { PATH_KEY, readLocalPath } from '@/lib/pathSync';
import { structureOf } from '@/lib/structures';

type Progress = { name: string; stage: 'reading' | 'analysing' | 'saving' | 'done' | 'failed' | 'no_text'; note?: string };
const STAGE: Record<Progress['stage'], string> = { reading: 'Reading the file…', analysing: 'Finding sections and details…', saving: 'Saving in this browser…', done: 'Ready', failed: 'Not imported', no_text: 'Kept, but no text could be read' };
const EMPTY_ANALYSIS: Analysis = { meta: {}, metaSource: {}, headings: [], passages: [], findings: [], bibliography: 0, chars: 0, truncated: false };
const META_LABELS: Record<keyof DocMeta, string> = { title: 'Title', authors: 'Authors', institution: 'Institution', year: 'Year', docType: 'Type' };
const TYPE_LABELS = { thesis: 'Thesis or dissertation', paper: 'Paper', document: 'Other document' };
const mb = (n: number) => (n < 1_000_000 ? `${Math.max(1, Math.round(n / 1000))} KB` : `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)} MB`);
const newId = () => {
  try {
    return `doc-${crypto.randomUUID()}`;
  } catch {
    return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
};

export default function SourcesPage() {
  const { user, ready } = useAccount();
  const { owner, docs, guestDocs, loaded, reload } = useSourceDocs();
  const [permission, setPermission] = useState(false);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<{ usage?: number; quota?: number }>({});
  const [open, setOpen] = useState('');
  const [editing, setEditing] = useState('');
  const [draft, setDraft] = useState<DocMeta>({});
  const [confirmDelete, setConfirmDelete] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [checkText, setCheckText] = useState('');
  const [checkPart, setCheckPart] = useState('');
  const [close, setClose] = useState<Closeness[] | null>(null);
  const [note, setNote] = useState('');
  // The thesis, for the reference library and the writing check. Same loading and saving as the other pages.
  const [path, setPath] = useState<PathState>(emptyPath);
  const [pathLoaded, setPathLoaded] = useState(false);
  const pathRef = useRef(path);
  pathRef.current = path;
  useEffect(() => {
    const p = readLocalPath();
    if (p) setPath(p);
    setPathLoaded(true);
  }, []);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== PATH_KEY || !e.newValue) return;
      try {
        const next = JSON.parse(e.newValue);
        if (isPathState(next)) setPath(next);
      } catch {}
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const replace = useCallback((p: PathState) => setPath(p), []);
  usePathSync({ userId: ready ? user?.id : undefined, loaded: pathLoaded, path, replace });
  useEffect(() => {
    storageEstimate().then(setUsage);
  }, [docs]);

  const ready_ = docs.filter((d) => d.status === 'ready');
  const totalChars = docs.reduce((n, d) => n + d.chars, 0);

  async function importFiles(files: File[]) {
    if (!owner || !files.length) return;
    setBusy(true);
    setNote('');
    const list: Progress[] = files.map((f) => ({ name: f.name, stage: 'reading' }));
    const update = (i: number, p: Partial<Progress>) => {
      list[i] = { ...list[i], ...p };
      setProgress([...list]);
    };
    setProgress([...list]);
    let have = docs.length;
    let chars = totalChars;
    for (const [i, file] of files.entries()) {
      const base = { id: newId(), owner, fileName: file.name, kind: /\.docx$/i.test(file.name) ? 'docx' : 'pdf', fileBytes: file.size, pages: 0, importedAt: new Date().toISOString(), permission: { confirmedAt: new Date().toISOString() } } as const;
      if (docs.some((d) => d.fileName === file.name && d.fileBytes === file.size)) {
        update(i, { stage: 'failed', note: 'This file is already in your documents. It was not imported twice.' });
        continue;
      }
      if (have >= MAX_DOCS) {
        update(i, { stage: 'failed', note: `You already have ${MAX_DOCS} documents, the most this browser keeps. Remove one you no longer need, then import this file again.` });
        continue;
      }
      if (file.size > MAX_DOC_BYTES) {
        update(i, { stage: 'failed', note: 'This file is larger than 100 MB. Save a copy without large images, or split it, then import it again.' });
        continue;
      }
      let doc: SourceDoc;
      try {
        const x = await extractFile(file.name, new Uint8Array(await file.arrayBuffer()));
        update(i, { stage: 'analysing' });
        await new Promise((r) => setTimeout(r, 0));
        const a = analyse(x);
        const noText = !x.lines.length;
        doc = {
          ...base, ...a, kind: x.kind, pages: x.pages,
          status: noText ? 'no_text' : 'ready',
          ...(noText ? { statusNote: 'No text could be read: this looks like a scanned document (images of pages). Supervisor cannot read images. Use a PDF with selectable text, or run text recognition (OCR) first, then import it again.' }
            : a.truncated ? { statusNote: `This document is very long: only its first ${count(a.chars)} characters were kept. The rest was not imported.` } : {}),
        };
      } catch (e) {
        doc = { ...base, ...EMPTY_ANALYSIS, status: 'failed', statusNote: e instanceof DocProblem ? e.message : 'This file could not be read. Save it again as PDF or DOCX, then import it again.' };
      }
      if (chars + doc.chars > MAX_TOTAL_CHARS) {
        update(i, { stage: 'failed', note: `Your documents would hold more than ${count(MAX_TOTAL_CHARS)} characters, the most this browser keeps for Supervisor. Remove a document you no longer need, then import this file again.` });
        continue;
      }
      update(i, { stage: 'saving' });
      try {
        await saveDoc(doc);
        have++;
        chars += doc.chars;
        update(i, { stage: doc.status === 'ready' ? 'done' : doc.status === 'no_text' ? 'no_text' : 'failed', note: doc.statusNote ?? (doc.status === 'ready' ? `${count(doc.passages.length)} passages, ${count(doc.findings.length)} details found.` : undefined) });
      } catch (e) {
        update(i, { stage: 'failed', note: e instanceof StoreFullError ? 'This browser has no more room for documents. Nothing was changed. Remove a document you no longer need, then try again.' : 'This document could not be saved in this browser. Nothing was changed. Try again.' });
      }
    }
    await reload();
    setBusy(false);
  }

  async function remove(id: string) {
    await deleteDoc(id);
    setConfirmDelete('');
    if (open === id) setOpen('');
    await reload();
  }

  async function saveMeta(d: SourceDoc) {
    const corrected = Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])) as DocMeta;
    try {
      await saveDoc({ ...d, corrected });
      setEditing('');
      await reload();
    } catch {
      setNote('The corrected details could not be saved in this browser. Try again.');
    }
  }

  async function keepGuestDocs() {
    if (!owner) return;
    for (const d of guestDocs) await saveDoc({ ...d, owner });
    await reload();
  }

  /** Adds the document to the reference library with the details it states. Missing details stay missing. */
  function addToLibrary(d: SourceDoc) {
    const stored = readLocalPath();
    const p = stored && (stored.savedAt ?? '') > (pathRef.current.savedAt ?? '') ? stored : pathRef.current;
    if (!p.started) return setNote('Start your thesis on My thesis first: the reference library belongs to it.');
    const m = effectiveMeta(d);
    if (!m.title) return setNote('Add the title of this document first, with Correct details.');
    const draftRef: Draft = { type: m.docType === 'thesis' ? 'thesis' : m.docType === 'paper' ? 'article' : 'other', title: m.title, authors: m.authors ? parseAuthors(m.authors) : [], ...(m.year ? { year: m.year } : {}), ...(m.docType === 'thesis' && m.institution ? { school: m.institution } : {}) };
    const lib = libraryOf(p);
    const dup = duplicateOf(draftRef, lib.refs);
    if (dup) return setNote(`This document is already in your reference library as [@${dup.key}].`);
    const next = { ...p, library: addRef(lib, draftRef, 'manual'), savedAt: new Date().toISOString() };
    if (!put(PATH_KEY, JSON.stringify(next))) return setNote('This browser could not save the change. Nothing was changed.');
    setPath(next);
    setNote(`Added to your reference library as [@${next.library!.refs.at(-1)!.key}]. Check its details on the Document page: some may be missing.`);
  }

  const parts = structureOf(path).parts.filter((x) => (path.parts?.[x.id] ?? '').trim());
  const runCheck = () => setClose(closeness(checkPart ? path.parts?.[checkPart] ?? '' : checkText, ready_.map((d) => ({ ...d, meta: effectiveMeta(d) }))));

  return (
    <>
      <h1>My sources</h1>
      <p className="lede">Theses, papers and reports you have collected. Supervisor finds their structure, methods, data, results and limits, with the page each one comes from, and shows you what applies to your step.</p>

      <div className="notice" style={{ marginTop: 12 }} aria-label="Using sources honestly">
        <p><b>Use sources honestly.</b> Another researcher’s ideas, methods, data and results stay theirs. Read, compare and write in your own words, and cite every idea, method, finding or quotation you use, with its page. Supervisor never writes your thesis from a source, and it shows when your text is too close to one.</p>
      </div>

      <div className="sheet" style={{ marginTop: 16 }}>
        <h2>Import documents</h2>
        <label className="check" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 8 }}>
          <input type="checkbox" checked={permission} onChange={(e) => setPermission(e.target.checked)} />
          <span>I may use these documents for my research: I wrote them, they are openly licensed, or my library or university gives me access. I will cite them and respect their copyright.</span>
        </label>
        <div className="field" style={{ marginTop: 10 }}>
          <label htmlFor="src-files">PDF or Word files</label>
          <input id="src-files" type="file" multiple accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={!permission || busy || !owner} onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; importFiles(f); }} />
          <p className="hint">Files are read in this browser and never uploaded. Only their text, with page numbers, is kept, in this browser on this computer: it is not saved to your account. Up to {MAX_DOCS} documents, 100 MB each.</p>
        </div>
        {progress.length ? (
          <ul className="todo" aria-label="Import progress">
            {progress.map((p, i) => <li key={i}><b>{p.name}</b>: {STAGE[p.stage]}{p.note ? `. ${p.note}` : ''}</li>)}
          </ul>
        ) : null}
        {loaded ? <p className="hint">{docs.length} {docs.length === 1 ? 'document' : 'documents'}, {count(totalChars)} characters of text.{usage.usage !== undefined && usage.quota ? ` This site uses ${mb(usage.usage)} of the ${mb(usage.quota)} this browser allows.` : ''}{!storeIsPersistent() ? ' This browser cannot keep documents (a private window?): they will be gone when you close it.' : ''}</p> : null}
        {guestDocs.length ? <p className="notice">{guestDocs.length} {guestDocs.length === 1 ? 'document was' : 'documents were'} added in this browser before you signed in. <button type="button" className="linklike" onClick={keepGuestDocs}>Keep {guestDocs.length === 1 ? 'it' : 'them'} with this account</button></p> : null}
      </div>

      {note ? <p className="hint ok" role="status" style={{ marginTop: 10 }}>{note}</p> : null}

      {ready_.length ? (
        <div className="sheet" style={{ marginTop: 16 }}>
          <h2>Search your documents</h2>
          <div className="ask">
            <input aria-label="Search words" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') setHits(search(ready_.map((d) => ({ ...d, meta: effectiveMeta(d) })), query, { limit: 15 })); }} placeholder="dataset, RMSE, 数据集…" style={{ flex: 1, minWidth: 0 }} />
            <button type="button" className="btn ghost" disabled={!query.trim()} onClick={() => setHits(search(ready_.map((d) => ({ ...d, meta: effectiveMeta(d) })), query, { limit: 15 }))}>Search</button>
          </div>
          {hits ? (
            hits.length ? (
              <ul className="todo" aria-label="Search results">
                {hits.map((h, i) => (
                  <li key={i}><b>{h.title}</b> · {where(h.passage)}{h.passage.section ? ` · ${h.passage.section}` : ''}<br /><span>“{excerpt(h.passage.text, 50)}”</span></li>
                ))}
              </ul>
            ) : <p className="hint">No passage matches these words closely enough.</p>
          ) : null}
        </div>
      ) : null}

      <div className="sheet" style={{ marginTop: 16 }}>
        <h2>Your documents ({docs.length})</h2>
        {!docs.length && loaded ? <p className="hint">No documents yet.</p> : null}
        {docs.map((d) => {
          const m = effectiveMeta(d);
          const byCat = new Map<Category, typeof d.findings>();
          for (const f of d.findings) byCat.set(f.category, [...(byCat.get(f.category) ?? []), f]);
          return (
            <section className="group" key={d.id} data-testid="source-doc" aria-label={d.fileName}>
              <h3>{m.title ?? d.fileName}<span className={d.status === 'ready' ? 'tag' : 'tag blocking'}> {d.status === 'ready' ? 'Analysed' : d.status === 'no_text' ? 'No text found' : 'Could not be read'}</span></h3>
              <p className="hint">{d.fileName} · {d.kind.toUpperCase()}{d.pages ? ` · ${d.pages} pages` : ''} · {mb(d.fileBytes)}{d.status === 'ready' ? ` · ${count(d.headings.length)} sections · ${count(d.findings.length)} details · ${count(d.bibliography)} references listed` : ''}</p>
              {d.statusNote ? <p className="notice">{d.statusNote}</p> : null}
              <ul className="todo">
                {(Object.keys(META_LABELS) as (keyof DocMeta)[]).map((k) => {
                  const v = m[k];
                  const src = d.corrected?.[k] ? 'corrected by you' : d.metaSource[k];
                  return <li key={k}>{META_LABELS[k]}: {v ? (k === 'docType' ? TYPE_LABELS[v as keyof typeof TYPE_LABELS] : v) : <i>not found in the document</i>}{v && src ? <span className="hint"> ({src})</span> : null}</li>;
                })}
              </ul>
              {editing === d.id ? (
                <div className="form" aria-label="Correct details">
                  {(['title', 'authors', 'institution', 'year'] as const).map((k) => (
                    <div className="field" key={k}><label htmlFor={`meta-${k}`}>{META_LABELS[k]}</label><input id={`meta-${k}`} value={draft[k] ?? ''} onChange={(e) => setDraft((x) => ({ ...x, [k]: e.target.value }))} /></div>
                  ))}
                  <div className="field"><label htmlFor="meta-docType">Type</label><select id="meta-docType" value={draft.docType ?? 'document'} onChange={(e) => setDraft((x) => ({ ...x, docType: e.target.value as DocMeta['docType'] }))}>{Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                  <div className="ask"><button type="button" className="btn" onClick={() => saveMeta(d)}>Save details</button><button type="button" className="btn ghost" onClick={() => setEditing('')}>Cancel</button></div>
                </div>
              ) : null}
              <p className="ask" style={{ marginTop: 6 }}>
                {d.status === 'ready' ? <button type="button" className="linklike" aria-expanded={open === d.id} onClick={() => setOpen(open === d.id ? '' : d.id)}>{open === d.id ? 'Close' : 'Browse'}</button> : null}
                <button type="button" className="linklike" onClick={() => { setEditing(d.id); setDraft(effectiveMeta(d)); }}>Correct details</button>
                {d.status === 'ready' ? <button type="button" className="linklike" onClick={() => addToLibrary(d)}>Add to my reference library</button> : null}
                {confirmDelete === d.id ? (
                  <>
                    <button type="button" className="linklike" onClick={() => remove(d.id)}>Remove for good</button>
                    <button type="button" className="linklike" onClick={() => setConfirmDelete('')}>Keep it</button>
                  </>
                ) : <button type="button" className="linklike" aria-label={`Remove ${d.fileName}`} onClick={() => setConfirmDelete(d.id)}>Remove</button>}
              </p>
              {open === d.id ? (
                <div aria-label={`Contents of ${d.fileName}`}>
                  <details open>
                    <summary>Structure ({d.headings.length} headings)</summary>
                    <ul className="todo">{d.headings.map((h, i) => <li key={i} style={{ paddingLeft: (h.level - 1) * 14 }}>{h.text} <span className="hint">({where(h)})</span></li>)}</ul>
                  </details>
                  {[...byCat.entries()].map(([cat, fs]) => (
                    <details key={cat}>
                      <summary>{CATEGORY_LABELS[cat]} ({fs.length})</summary>
                      <ul className="todo">{fs.map((f, i) => <li key={i}>“{f.text}” <span className="hint">({where(f)}{f.section ? `, ${f.section}` : ''})</span></li>)}</ul>
                    </details>
                  ))}
                  <p className="hint">These are sentences from the document, with their location. Nothing here is a summary or an addition.</p>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      {ready_.length ? (
        <div className="sheet" style={{ marginTop: 16 }}>
          <h2>Is my text too close to a source?</h2>
          <p className="hint">Finds paragraphs of your text that repeat five words in a row (or eight Chinese characters) from your documents. Nothing is sent anywhere.</p>
          {parts.length ? (
            <div className="field">
              <label htmlFor="check-part">Part of my document</label>
              <select id="check-part" value={checkPart} onChange={(e) => setCheckPart(e.target.value)}>
                <option value="">Paste text instead</option>
                {parts.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
              </select>
            </div>
          ) : null}
          {!checkPart ? <div className="field"><label htmlFor="check-text">Text to check</label><textarea id="check-text" rows={5} value={checkText} onChange={(e) => setCheckText(e.target.value)} /></div> : null}
          <div className="ask"><button type="button" className="btn ghost" disabled={!checkPart && !checkText.trim()} onClick={runCheck}>Check</button></div>
          {close ? (
            close.length ? (
              <ul className="todo" aria-label="Passages too close to a source">
                {close.map((c, i) => (
                  <li key={i}>
                    <b>{c.level === 'very_close' ? 'Very close to its source' : 'Close to its source'}</b> ({Math.round(c.share * 100)}% of its word sequences): “{excerpt(c.paragraph, 25)}”<br />
                    <span className="hint">Source: {c.hit.title}, {where(c.hit.passage)}{c.hit.passage.section ? `, ${c.hit.passage.section}` : ''}. Rewrite it in your own words, from your understanding, and cite the source. If you keep the exact words, put them in quotation marks with the page.</span>
                  </li>
                ))}
              </ul>
            ) : <p className="hint ok" role="status">No paragraph repeats a sequence of words from your documents.</p>
          ) : null}
          <p className="hint">This only compares with your own documents, not with everything published. <Link href="/document">Open My document</Link></p>
        </div>
      ) : null}
    </>
  );
}
