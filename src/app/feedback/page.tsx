'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AiErrorNote, AiLimitsNote } from '@/components/AiStatus';
import { useAccount } from '@/components/useAccount';
import { put, useProfiles } from '@/components/useProfiles';
import { usePathSync } from '@/components/usePathSync';
import { addReport, buildReport, compareReports, exportReports, newId, removeReport, reportsOf, type ChapterReport } from '@/lib/chapterFeedback';
import type { Feedback } from '@/lib/feedback';
import { loadAi } from '@/lib/aiSettings';
import { count, FEEDBACK_LIMIT, MAX_UPLOAD_LABEL } from '@/lib/limits';
import { emptyPath, isPathState, type PathState } from '@/lib/path';
import { PATH_KEY, readLocalPath } from '@/lib/pathSync';
import { canRetry, errorText, fileProblem, request, requestAi } from '@/lib/request';
import { authHeaders } from '@/lib/supabase';
import type { RefResult } from '@/lib/references';
import { DEGREE_LABELS, type DegreeType } from '@/lib/types';

const STATUS: Record<RefResult['status'], string> = {
  verified: 'Found',
  possible_match: 'Compare',
  not_found: 'No match',
  unchecked: 'Not checked',
};
const SEV = { major: 'Major', moderate: 'Moderate', minor: 'Minor' };
const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'Date not recorded' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};
const label = (r: ChapterReport) => `${r.chapter}, ${when(r.analyzedAt)}${r.status === 'current' ? ' (latest)' : ''}`;
const versionText = (r: ChapterReport) => `Version ${r.snapshot.version.slice(0, 8)} · ${count(r.snapshot.words)} words · ${count(r.snapshot.totalChars)} characters${r.snapshot.file ? ` · from ${r.snapshot.file}` : ''}`;

function FeedbackView({ feedback }: { feedback: Feedback }) {
  return (
    <>
      {feedback.coverage && !feedback.coverage.complete ? <p className="notice" style={{ marginTop: 8 }}>This feedback covers only the first {count(feedback.coverage.readChars)} of {count(feedback.coverage.totalChars)} characters. It says nothing about the rest.</p> : null}
      <p style={{ marginTop: 8 }}>{feedback.summary}</p>
      {feedback.strengths.length ? (
        <section className="group"><h3>What works</h3><ul>{feedback.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul></section>
      ) : null}
      <section className="group">
        <h2>What to work on</h2>
        {feedback.issues.map((i, n) => (
          <div className="item" key={n}>
            <h3>{i.problem}<span className="tag">{SEV[i.severity]}</span></h3>
            {i.location ? <p className="hint">{i.location}</p> : null}
            <p>{i.why_it_matters}</p>
            <ul className="ex"><li>{i.guiding_question}</li></ul>
          </div>
        ))}
      </section>
      {feedback.next_steps.length ? (
        <section className="group"><h2>Next steps</h2><ol>{feedback.next_steps.map((s, i) => <li key={i}>{s}</li>)}</ol></section>
      ) : null}
    </>
  );
}

function Comparison({ a, b }: { a: ChapterReport; b: ChapterReport }) {
  const c = compareReports(a, b);
  const side = (r: ChapterReport, title: string, sev: Record<string, number>) => (
    <div>
      <h3>{title}{r.status === 'current' ? <span className="tag latest"> Latest</span> : null}</h3>
      <p className="hint">{r.chapter} · {when(r.analyzedAt)}</p>
      <p className="hint">{versionText(r)}</p>
      <p className="hint">{sev.major} major, {sev.moderate} moderate, {sev.minor} minor</p>
      <p style={{ marginTop: 6 }}>{r.feedback.summary}</p>
    </div>
  );
  const list = (items: { problem: string; severity: keyof typeof SEV }[]) => (items.length ? <ul>{items.map((i, n) => <li key={n}>{i.problem} <span className="tag">{SEV[i.severity]}</span></li>)}</ul> : <p className="hint">None.</p>);
  return (
    <div className="sheet" style={{ marginTop: 16 }} aria-label="Comparison of two reports">
      <h2>Comparison</h2>
      <div className="compare-grid">
        {side(c.earlier, 'Earlier report', c.severities.earlier)}
        {side(c.later, 'Later report', c.severities.later)}
      </div>
      <section className="group">
        <h3>The chapter analysed</h3>
        {c.sameVersion ? (
          <p>Both reports analysed the same version of the chapter.</p>
        ) : (
          <>
            <p>{count(c.text.kept)} paragraphs unchanged, {count(c.text.added.length)} new or changed, {count(c.text.removed.length)} removed. {count(c.text.wordsBefore)} words before, {count(c.text.wordsAfter)} after.</p>
            {c.text.added.length ? <details><summary>New or changed paragraphs ({c.text.added.length})</summary><ul>{c.text.added.slice(0, 50).map((t, i) => <li key={i}>{t.length > 300 ? `${t.slice(0, 300)}…` : t}</li>)}</ul></details> : null}
            {c.text.removed.length ? <details><summary>Removed or replaced paragraphs ({c.text.removed.length})</summary><ul>{c.text.removed.slice(0, 50).map((t, i) => <li key={i}>{t.length > 300 ? `${t.slice(0, 300)}…` : t}</li>)}</ul></details> : null}
          </>
        )}
      </section>
      <section className="group">
        <h3>Points raised</h3>
        <p className="hint">Matched by their wording, so a point phrased very differently may appear on both sides.</p>
        <div className="compare-grid">
          <div><h3>Only in the earlier report</h3>{list(c.issues.onlyEarlier)}</div>
          <div><h3>Only in the later report</h3>{list(c.issues.onlyLater)}</div>
          <div><h3>In both</h3>{list(c.issues.both)}</div>
        </div>
      </section>
    </div>
  );
}

export default function FeedbackPage() {
  const { profile, degree, setDegree } = useProfiles();
  const { user, ready } = useAccount();
  const [tab, setTab] = useState<'chapter' | 'refs'>('chapter');
  const [chapters, setChapters] = useState<{ title: string; text: string }[]>([]);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [discipline, setDiscipline] = useState('');
  const [language, setLanguage] = useState('English');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [refs, setRefs] = useState('');
  const [refResults, setRefResults] = useState<RefResult[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadedFile, setLoadedFile] = useState('');
  // Phase P3: the history lives in the saved work, like the rest of the thesis.
  const [path, setPath] = useState<PathState>(emptyPath);
  const [loaded, setLoaded] = useState(false);
  const [viewId, setViewId] = useState('');
  const [saveNote, setSaveNote] = useState<{ kind: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const [pickA, setPickA] = useState('');
  const [pickB, setPickB] = useState('');
  const [comparing, setComparing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState('');
  // Phase P4: what a failed request asked for, so "Try again" sends exactly the same thing.
  type Ask = { requestId: string; chapter: string; text: string; file: string; degree: string; discipline: string; language: string; body: unknown };
  const [failedAsk, setFailedAsk] = useState<Ask | null>(null);
  const [retryable, setRetryable] = useState(false);
  const [ownKey, setOwnKey] = useState(false);
  const pathRef = useRef(path);
  pathRef.current = path;

  useEffect(() => {
    const p = readLocalPath();
    if (p) setPath(p);
    const m = /^#report-(.+)$/.exec(window.location.hash);
    if (m) setViewId(decodeURIComponent(m[1]));
    setOwnKey(!!loadAi());
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded && path.started) put(PATH_KEY, JSON.stringify(path));
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

  /** The newest copy in this browser, so another tab's edits are never lost. */
  const latestPath = () => {
    const stored = readLocalPath();
    const p = pathRef.current;
    return stored && (stored.savedAt ?? '') > (p.savedAt ?? '') ? stored : p;
  };
  /** Writes first: if the browser cannot store it, nothing changes and the student is told. */
  const commit = (next: PathState) => {
    const stamped = { ...next, savedAt: new Date().toISOString() };
    if (!put(PATH_KEY, JSON.stringify(stamped))) return false;
    setPath(stamped);
    return true;
  };

  function keep(f: Feedback, analysed: { requestId?: string; chapter: string; text: string; file: string; degree: string; discipline: string; language: string }) {
    const base = latestPath();
    if (!base.started) {
      setSaveNote({ kind: 'warn', text: 'This feedback is not kept after you leave the page, because no thesis is started in this browser. Start your thesis on My thesis to keep a history of your chapter feedback.' });
      return;
    }
    const r = addReport(base, buildReport({ chapter: analysed.chapter, text: analysed.text, file: analysed.file || undefined, feedback: f, requestId: analysed.requestId, settings: { degree: analysed.degree, discipline: analysed.discipline, language: analysed.language } }));
    if (r.status === 'duplicate') {
      setViewId(r.report.id);
      setSaveNote({ kind: 'ok', text: 'This report is already in your history. It was not saved twice.' });
      return;
    }
    if (r.status === 'full') {
      setSaveNote({ kind: 'error', text: `This report could not be added: your saved work would reach ${count(Math.round(r.bytes / 1000))} KB, above what Supervisor can store. Nothing was removed. Export your history, then delete reports you no longer need, and ask again.` });
      return;
    }
    if (!commit(r.path)) {
      setSaveNote({ kind: 'error', text: 'This browser’s storage is full, so the report could not be saved. Nothing was removed. Export your history, then delete reports you no longer need, and ask again.' });
      return;
    }
    setViewId(r.report.id);
    setSaveNote({ kind: 'ok', text: 'Saved to your feedback history.' });
  }

  function remove(id: string) {
    if (!commit(removeReport(latestPath(), id))) {
      setSaveNote({ kind: 'error', text: 'The report could not be deleted because this browser could not save the change.' });
      return;
    }
    setConfirmDelete('');
    if (viewId === id) setViewId('');
    if (pickA === id || pickB === id) setComparing(false);
  }

  function downloadHistory() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([exportReports(reportsOf(pathRef.current))], { type: 'application/json' }));
    a.download = `supervisor-feedback-history-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  }

  async function load(file: File) {
    const tooBig = fileProblem(file);
    if (tooBig) return setError(tooBig);
    setError('');
    setLoading(true);
    const f = new FormData();
    f.set('file', file);
    try {
      const j = await request<{ chapters: { title: string; text: string }[]; references: string[] }>('/api/chapters', { method: 'POST', body: f });
      setChapters(j.chapters);
      setRefs(j.references.join('\n'));
      setLoadedFile(file.name);
      if (j.chapters[0]) {
        setTitle(j.chapters[0].title);
        setText(j.chapters[0].text);
      } else setError('No chapters were found. Paste a chapter below.');
    } catch (x) {
      setChapters([]);
      setLoadedFile('');
      setError(errorText(x));
    } finally {
      setLoading(false);
    }
  }

  async function post<T>(url: string, body: unknown, done: (j: T) => void, onFail?: (x: unknown) => void) {
    setBusy(true);
    setError('');
    setRetryable(false);
    try {
      done(await requestAi<T>(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(await authHeaders()) }, body: JSON.stringify(body) }));
    } catch (x) {
      setError(errorText(x));
      setRetryable(canRetry(x));
      onFail?.(x);
    } finally {
      setBusy(false);
    }
  }

  function send(ask: Ask) {
    setSaveNote(null);
    setFailedAsk(null);
    post<Feedback>('/api/feedback', ask.body, (f) => {
      setFeedback(f);
      setViewId('');
      keep(f, ask);
    }, () => setFailedAsk(ask));
  }

  function askFeedback() {
    // What is analysed is fixed when the student asks, so the saved version is exactly the text that was sent.
    // The text stays in the form whatever happens.
    send({ requestId: newId(), chapter: title, text, file: chapters.some((c) => c.title === title) ? loadedFile : '', degree, discipline, language, body: { degree, discipline, title, text, language, llm: loadAi() ?? undefined } });
  }

  const reports = reportsOf(path);
  const viewed = reports.find((r) => r.id === viewId) ?? null;
  const chapterNames = [...new Set(reports.map((r) => r.chapter))];
  const a = reports.find((r) => r.id === pickA);
  const b = reports.find((r) => r.id === pickB);
  const startCompare = () => {
    if (!pickA || !pickB) {
      const forChapter = viewed ? reports.filter((r) => r.chapter === viewed.chapter) : [];
      const two = forChapter.length >= 2 ? forChapter : reports;
      setPickB(two[0]?.id ?? '');
      setPickA(two[1]?.id ?? '');
    }
    setComparing(true);
  };

  return (
    <>
      <h1>Feedback on your writing</h1>
      <p className="lede">You write the thesis. Supervisor reads it, points out weak spots and asks the questions a good supervisor would ask.</p>
      {sync.conflict ? <p className="notice" role="alert" style={{ marginTop: 12 }}>Two versions of your thesis exist. <Link href="/">Open My thesis</Link> to choose one. Your feedback history is part of each version.</p> : null}
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'chapter'} onClick={() => setTab('chapter')}>Chapter</button>
        <button role="tab" aria-selected={tab === 'refs'} onClick={() => setTab('refs')}>References</button>
      </div>
      <div className="form">
        <div className="field">
          <label htmlFor="f">Thesis file (optional)</label>
          <input id="f" type="file" accept=".docx" disabled={loading} onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
          <p className="hint">Word files up to {MAX_UPLOAD_LABEL}.</p>
          {loading ? <p className="hint" role="status">Reading your file…</p> : null}
          {loadedFile && !loading ? <p className="hint ok" role="status">{loadedFile} is ready.</p> : null}
        </div>
        {tab === 'chapter' ? (
          <>
            {chapters.length ? (
              <div className="field">
                <label htmlFor="c">Chapter</label>
                <select id="c" value={title} onChange={(e) => { const c = chapters.find((x) => x.title === e.target.value); if (c) { setTitle(c.title); setText(c.text); } }}>
                  {chapters.map((c) => <option key={c.title}>{c.title}</option>)}
                </select>
              </div>
            ) : (
              <div className="field">
                <label htmlFor="cn">Chapter name</label>
                <input id="cn" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Chapter 3 Method" />
                <p className="hint">Reports of the same chapter are kept together in your history.</p>
              </div>
            )}
            <div className="two">
              <div className="field">
                <label htmlFor="d">Degree</label>
                <select id="d" value={degree} onChange={(e) => setDegree(e.target.value as DegreeType)}>
                  {(profile?.scope.degree_types ?? []).map((d) => <option key={d} value={d}>{DEGREE_LABELS[d]}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="l">Feedback language</label>
                <select id="l" value={language} onChange={(e) => setLanguage(e.target.value)}>
                  <option>English</option><option>French</option><option>Chinese</option><option>Arabic</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="s">Discipline</label>
              <input id="s" value={discipline} onChange={(e) => setDiscipline(e.target.value)} placeholder="Computer science" />
            </div>
            <div className="field">
              <label htmlFor="t">Chapter text</label>
              <textarea id="t" value={text} onChange={(e) => setText(e.target.value)} />
              {text.length > FEEDBACK_LIMIT ? <p className="hint">Feedback reads the first {count(FEEDBACK_LIMIT)} of these {count(text.length)} characters.</p> : null}
            </div>
            <div><button className="btn" disabled={busy || loading} onClick={askFeedback}>{busy ? 'Reading…' : 'Get feedback'}</button></div>
            {loaded ? <AiLimitsNote ownKey={ownKey} /> : null}
          </>
        ) : (
          <>
            <div className="field">
              <label htmlFor="r">References, one per line</label>
              <textarea id="r" value={refs} onChange={(e) => setRefs(e.target.value)} />
            </div>
            <div><button className="btn" disabled={busy || loading} onClick={() => post<{ results: RefResult[] }>('/api/references', { entries: refs.split('\n') }, (j) => setRefResults(j.results))}>{busy ? 'Checking…' : 'Check references'}</button></div>
          </>
        )}
        <AiErrorNote message={error} busy={busy} retryable={retryable && tab === 'chapter' && !!failedAsk} onRetry={() => failedAsk && send(failedAsk)} />
      </div>
      {tab === 'chapter' && saveNote ? <p className={saveNote.kind === 'error' ? 'error' : saveNote.kind === 'warn' ? 'notice' : 'hint ok'} role={saveNote.kind === 'ok' ? 'status' : 'alert'} style={{ marginTop: 12 }}>{saveNote.text}</p> : null}
      {tab === 'chapter' && viewed ? (
        <div className="sheet" style={{ marginTop: 24, maxWidth: 820 }} id="report">
          <h2>What your supervisor would say</h2>
          <p className="hint" style={{ marginTop: 6 }}>
            <strong>{viewed.chapter}</strong> · analysed {when(viewed.analyzedAt)} · <span className={viewed.status === 'current' ? 'tag latest' : 'tag'}>{viewed.status === 'current' ? 'Latest report' : 'Earlier report'}</span>
          </p>
          <p className="hint">{versionText(viewed)}</p>
          <details style={{ marginTop: 6 }}><summary>The chapter text analysed</summary><p style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{viewed.snapshot.text}</p></details>
          <FeedbackView feedback={viewed.feedback} />
        </div>
      ) : tab === 'chapter' && feedback ? (
        <div className="sheet" style={{ marginTop: 24, maxWidth: 820 }}>
          <h2>What your supervisor would say</h2>
          <FeedbackView feedback={feedback} />
        </div>
      ) : null}
      {tab === 'chapter' && loaded && reports.length ? (
        <div className="sheet" style={{ marginTop: 24, maxWidth: 820 }} id="history">
          <h2>Feedback history</h2>
          <p className="hint">{count(reports.length)} {reports.length === 1 ? 'report' : 'reports'} on {count(chapterNames.length)} {chapterNames.length === 1 ? 'chapter' : 'chapters'}. A new analysis never replaces an earlier one. Each report keeps the chapter text it analysed. {user ? (sync.status === 'saved' ? 'Saved to your account.' : sync.status === 'unconfirmed' ? 'Saved in this browser, not confirmed in your account yet.' : '') : 'Saved in this browser. Sign in to keep it in your account.'}</p>
          {chapterNames.map((name) => (
            <section className="group" key={name} aria-label={`Reports for ${name}`}>
              <h3>{name}</h3>
              {reports.filter((r) => r.chapter === name).map((r) => (
                <div className="history-row" key={r.id}>
                  <span className="when">{when(r.analyzedAt)}</span>
                  {r.status === 'current' ? <span className="tag latest">Latest</span> : <span className="tag">Earlier</span>}
                  <span className="hint">{versionText(r)}</span>
                  <span className="acts">
                    <button type="button" className="linklike" aria-label={`Open the report of ${when(r.analyzedAt)} on ${r.chapter}`} onClick={() => { setViewId(r.id); setSaveNote(null); document.getElementById('report')?.scrollIntoView?.(); }}>{viewId === r.id ? 'Open now' : 'Open'}</button>
                    {confirmDelete === r.id ? (
                      <>
                        <button type="button" className="linklike" onClick={() => remove(r.id)}>Delete this report for good</button>
                        <button type="button" className="linklike" onClick={() => setConfirmDelete('')}>Keep it</button>
                      </>
                    ) : (
                      <button type="button" className="linklike" aria-label={`Delete the report of ${when(r.analyzedAt)} on ${r.chapter}`} onClick={() => setConfirmDelete(r.id)}>Delete</button>
                    )}
                  </span>
                </div>
              ))}
            </section>
          ))}
          <section className="group">
            <h3>Compare two reports</h3>
            {reports.length < 2 ? <p className="hint">After a second analysis, you can compare two reports and the chapter versions they read.</p> : (
              <>
                <div className="compare-pick">
                  <div className="field">
                    <label htmlFor="cmp-a">First report</label>
                    <select id="cmp-a" value={pickA} onChange={(e) => { setPickA(e.target.value); setComparing(false); }}>
                      <option value="">Choose a report</option>
                      {reports.map((r) => <option key={r.id} value={r.id}>{label(r)}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="cmp-b">Second report</label>
                    <select id="cmp-b" value={pickB} onChange={(e) => { setPickB(e.target.value); setComparing(false); }}>
                      <option value="">Choose a report</option>
                      {reports.map((r) => <option key={r.id} value={r.id}>{label(r)}</option>)}
                    </select>
                  </div>
                </div>
                <div className="ask">
                  <button type="button" className="btn ghost" onClick={startCompare}>Compare</button>
                </div>
                {comparing && a && b && a.id === b.id ? <p className="notice">Choose two different reports.</p> : null}
              </>
            )}
          </section>
          <div className="ask">
            <button type="button" className="btn ghost" onClick={downloadHistory}>Export my feedback history</button>
          </div>
        </div>
      ) : null}
      {tab === 'chapter' && comparing && a && b && a.id !== b.id ? <Comparison a={a} b={b} /> : null}
      {tab === 'refs' && refResults ? (
        <div className="sheet" style={{ marginTop: 24 }}>
          <h2>Reference check</h2>
          <p className="hint">“No match” does not mean a source is fake. Open the original to be sure.</p>
          <table className="table" style={{ marginTop: 12 }}>
            <thead><tr><th>Your entry</th><th>Result</th><th>Closest record</th></tr></thead>
            <tbody>
              {refResults.map((r, i) => (
                <tr key={i}><td>{r.entry}</td><td>{STATUS[r.status]}</td><td>{r.matchedTitle ?? '—'}{r.doi ? ` (${r.doi})` : ''}{r.note ? <p className="hint">{r.note}</p> : null}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
