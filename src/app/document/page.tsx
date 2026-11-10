'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useAccount } from '@/components/useAccount';
import { put, useProfiles } from '@/components/useProfiles';
import { ResearchEvidence } from '@/components/ResearchEvidence';
import { usePathSync } from '@/components/usePathSync';
import { reportsOf } from '@/lib/chapterFeedback';
import { count } from '@/lib/limits';
import { emptyPath, isPathState, type PathState, type StructureId } from '@/lib/path';
import { PATH_KEY, readLocalPath } from '@/lib/pathSync';
import { buildThesisDocx, exportFileName, exportSummary } from '@/lib/wordExport';
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
  const [exported, setExported] = useState(false);

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
      setExported(true);
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
      <ChapterFeedbackSummary path={path} />

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
        <p className="hint">Your text, part by part, as an editable Word file (.docx): numbered chapters and sections, tables, figure captions, equations, references and appendices, with your step notes in a separate appendix. Parts you have not written are marked, never filled in. The file is made in this browser: nothing is sent anywhere.</p>
        {exportError ? <p className="error" role="alert">{exportError}</p> : null}
        <ExportContents path={path} exported={exported} />
        <details style={{ marginTop: 10 }}>
          <summary>How to write tables, figures and equations for the Word file</summary>
          <ul className="todo">
            <li><code>## Heading</code> and <code>### Subheading</code>: sections, numbered 1.1 and 1.1.1 unless you number them yourself.</li>
            <li><code>Table: caption</code>, then rows like <code>| Model | Accuracy |</code>. A line <code>|---|---|</code> under the first row makes it the header.</li>
            <li><code>[Figure: caption]</code>: a numbered caption and a marked place where you insert the image in Word.</li>
            <li><code>$$ E = mc^2 $$</code>: a numbered equation, kept exactly as you type it.</li>
            <li><code>- item</code> or <code>1. item</code>: list items. <code>**bold**</code> and <code>*italic*</code>: emphasis.</li>
            <li>In References, each line is one entry, exported exactly as you typed it.</li>
          </ul>
        </details>
      </div>

      <div className="sheet" style={{ marginTop: 16 }}>
        {views.map((v, n) => (
          <div className="item" key={v.id}>
            <h3>
              <span>{n + 1}. {v.title}</span>
              <span className="tag">{STATE[v.state]}</span>
            </h3>
            <p className="hint">{count(v.words)} words{v.target ? `, usually ${count(v.target[0])}–${count(v.target[1])}` : ''}</p>
            {!v.ingredients.length ? <p className="hint">Optional. Left out of the Word file while empty.</p> : null}
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

/** Phase P3: where each chapter stands in its feedback history. The reports themselves open in Feedback. */
function ChapterFeedbackSummary({ path }: { path: PathState }) {
  const reports = reportsOf(path);
  if (!reports.length) return null;
  const chapters = [...new Set(reports.map((r) => r.chapter))];
  return (
    <div className="sheet" style={{ marginTop: 16 }} aria-label="Chapter feedback history">
      <h2>Chapter feedback</h2>
      <p className="hint">Every AI feedback report on your chapters is kept. A new analysis never replaces an earlier one.</p>
      {chapters.map((name) => {
        const mine = reports.filter((r) => r.chapter === name);
        const latest = mine[0];
        return (
          <div className="history-row" key={name}>
            <span className="when">{name}</span>
            <span className="hint">{mine.length} {mine.length === 1 ? 'report' : 'reports'}, latest {new Date(latest.analyzedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
            <span className="acts"><Link href={`/feedback#report-${encodeURIComponent(latest.id)}`} aria-label={`Open the latest feedback on ${name}`}>Open the latest report</Link></span>
          </div>
        );
      })}
      <p style={{ marginTop: 10 }}><Link href="/feedback#history">See and compare all reports</Link></p>
    </div>
  );
}

/** Phase P5: what the Word file will hold, and what it cannot hold faithfully. */
function ExportContents({ path, exported }: { path: PathState; exported: boolean }) {
  const s = exportSummary(path);
  const items = [
    `${s.chapters} numbered chapters`,
    `${s.sections} sections`,
    `${s.paragraphs} paragraphs`,
    s.tables ? `${s.tables} ${s.tables === 1 ? 'table' : 'tables'}` : '',
    s.figures ? `${s.figures} figure ${s.figures === 1 ? 'caption' : 'captions'}` : '',
    s.equations ? `${s.equations} ${s.equations === 1 ? 'equation' : 'equations'}` : '',
    s.references ? `${s.references} reference ${s.references === 1 ? 'entry' : 'entries'}` : '',
    s.appendices ? 'appendices' : '',
  ].filter(Boolean);
  return (
    <div style={{ marginTop: 10 }} aria-label="What the Word file holds" role={exported ? 'status' : undefined}>
      <p className="hint">{exported ? 'Your Word file holds' : 'The Word file will hold'}: {items.join(', ')}.{s.emptyParts.length ? ` Not written yet, and marked as such: ${s.emptyParts.join(', ')}.` : ''}</p>
      <details>
        <summary>What you still do in Word</summary>
        <ul className="todo">{s.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
      </details>
    </div>
  );
}
