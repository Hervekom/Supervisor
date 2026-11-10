'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useAccount } from '@/components/useAccount';
import { put, useProfiles } from '@/components/useProfiles';
import { ResearchEvidence } from '@/components/ResearchEvidence';
import { usePathSync } from '@/components/usePathSync';
import { count } from '@/lib/limits';
import { emptyPath, isPathState, type PathState, type StructureId } from '@/lib/path';
import { PATH_KEY, readLocalPath } from '@/lib/pathSync';
import { buildThesisDocx, exportFileName } from '@/lib/wordExport';
import { ingredientStatus, partViews, REQUIRED_EXTRAS, stepTitle, STRUCTURES, structureOf, wordCount, type IngredientStatus } from '@/lib/structures';

const LABEL: Record<IngredientStatus, string> = { missing: 'Missing', started: 'In progress', ready: 'Ready', set_aside: 'Set aside' };
const STATE = { empty: 'Empty', writing: 'In progress', target_met: 'Length reached' };
const DEFAULT_MIN_WORDS = 25000;

export default function DocumentPage() {
  const router = useRouter();
  const { user, ready } = useAccount();
  const { profile, degree } = useProfiles();
  const [path, setPath] = useState<PathState>(emptyPath);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  /** Builds the Word file in this browser from what this page shows: nothing is sent anywhere. */
  async function downloadWord() {
    setExporting(true);
    setExportError('');
    try {
      const now = new Date();
      const bytes = await buildThesisDocx(path, now);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
      a.download = exportFileName(path, now);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
    } catch {
      setExportError('The Word file could not be prepared in this browser. Nothing was changed. Try again, or save a backup from My thesis.');
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    const p = readLocalPath();
    if (p) setPath(p);
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded) put(PATH_KEY, JSON.stringify(path));
  }, [path, loaded]);
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
  const sync = usePathSync({ userId: ready ? user?.id : undefined, loaded, path, replace });

  const edit = (u: (p: PathState) => PathState) => setPath((p) => ({ ...u(p), savedAt: new Date().toISOString() }));
  const setStructure = (id: StructureId) => edit((p) => ({ ...p, structure: id }));
  const setText = (id: string, text: string) => edit((p) => ({ ...p, parts: { ...p.parts, [id]: text } }));
  const goToStep = (id: string) => {
    const next = { ...path, current: id, savedAt: new Date().toISOString() };
    put(PATH_KEY, JSON.stringify(next));
    router.push('/');
  };

  if (!loaded) return null;
  if (!path.started) {
    return (
      <>
        <h1>My document</h1>
        <p className="lede">Your thesis will appear here, part by part.</p>
        <p style={{ marginTop: 16 }}><Link className="btn linkbtn" href="/">Start my thesis</Link></p>
      </>
    );
  }

  const minWords = (profile?.rules.find((r) => r.key === 'length.main_text.min_words' && degree && r.applies_to.includes(degree))?.value as number | undefined) ?? DEFAULT_MIN_WORDS;
  const views = partViews(path, minWords);
  const structure = structureOf(path);
  const mainWords = views.filter((v) => v.target).reduce((n, v) => n + v.words, 0);
  const percent = Math.min(100, Math.round((mainWords / minWords) * 100));

  return (
    <>
      <h1>My document</h1>
      <p className="lede">Each step gives you the ingredients for a part of your thesis. You write the text here, in your own words.</p>

      {sync.conflict ? <p className="notice" role="alert" style={{ marginTop: 12 }}>Two versions of your thesis exist. <Link href="/">Open My thesis</Link> to choose one.</p> : null}
      <ResearchEvidence path={path} />

      <div className="sheet" style={{ marginTop: 20 }}>
        <div className="field">
          <label htmlFor="structure">Structure</label>
          <select id="structure" value={structure.id} onChange={(e) => setStructure(e.target.value as StructureId)}>
            {STRUCTURES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <p className="hint">{structure.bestFor}</p>
        </div>
        <div className="meter" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Main text length" style={{ marginTop: 14 }}><span style={{ width: `${percent}%` }} /></div>
        <p className="hint">{count(mainWords)} of at least {count(minWords)} words in the main text</p>
        <div className="ask" style={{ marginTop: 12 }}>
          <button type="button" className="btn" disabled={exporting} onClick={downloadWord}>{exporting ? 'Preparing your Word file…' : 'Download Word'}</button>
        </div>
        <p className="hint">Your text, part by part, as an editable Word file (.docx), with your step notes in an appendix. Parts you have not written are marked, never filled in. Add your university’s template, figures, tables and equations in Word or LibreOffice.</p>
        {exportError ? <p className="error" role="alert">{exportError}</p> : null}
      </div>

      <div className="sheet" style={{ marginTop: 16 }}>
        {views.map((v, n) => (
          <div className="item" key={v.id}>
            <h3>
              <span>{n + 1}. {v.title}</span>
              <span className="tag">{STATE[v.state]}</span>
            </h3>
            <p className="hint">{count(v.words)} words{v.target ? `, usually ${count(v.target[0])}–${count(v.target[1])}` : ''}</p>
            <ul className="todo">
              {v.ingredients.map((g) => (
                <li key={`${g.step}-${g.label}`}>
                  {g.label}: {LABEL[ingredientStatus(path, g.step)]}.{' '}
                  <button type="button" className="linklike" aria-label={`Open the step ${stepTitle(g.step)}`} onClick={() => goToStep(g.step)}>Open this step</button>
                </li>
              ))}
            </ul>
            <p style={{ marginTop: 8 }}>
              <button className="btn ghost" aria-expanded={open === v.id} onClick={() => setOpen(open === v.id ? '' : v.id)}>{open === v.id ? 'Close' : v.words ? 'Continue writing' : 'Write this part'}</button>
            </p>
            {open === v.id ? (
              <div className="field" style={{ marginTop: 10 }}>
                <label htmlFor={`part-${v.id}`}>Your text for {v.title}</label>
                <textarea id={`part-${v.id}`} rows={14} value={path.parts?.[v.id] ?? ''} onChange={(e) => setText(v.id, e.target.value)} />
                <p className="hint">{count(wordCount(path.parts?.[v.id] ?? ''))} words. This saves automatically. Start a line with ## for a subsection heading in the Word file.</p>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <details style={{ marginTop: 16 }}>
        <summary>Also needed in the final thesis</summary>
        <ul className="todo">{REQUIRED_EXTRAS.map((x) => <li key={x}>{x}</li>)}</ul>
        <p className="hint">Confirm the exact order and format with your school’s rules.</p>
      </details>
    </>
  );
}
