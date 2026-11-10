'use client';
import { useState } from 'react';
import type { Report, Result } from '@/lib/check';
import { checkInBrowser, CheckProblem, type Extraction, type Stage, type Stages } from '@/lib/browserCheck';
import { MESSAGES } from '@/lib/messages';
import { DEGREE_LABELS, type DegreeType, type Profile } from '@/lib/types';
import { useProfiles } from '@/components/useProfiles';

const STAGE_LABEL: Record<Stage, string> = {
  reading: 'Open the file in this browser',
  extracting: 'Read the text, headings, tables and formatting',
  checking: 'Apply your university’s rules to the whole thesis',
};
const STATE_LABEL = { pending: 'Waiting', active: 'In progress…', done: 'Done', failed: 'Failed' };
const mb = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

/** What the browser read, so the student can see that nothing is missing. */
function Progress({ stages, extraction }: { stages: Stages; extraction: Extraction | null }) {
  return (
    <div className="sheet" aria-live="polite" style={{ marginBottom: 16 }}>
      <h2>Checking in this browser</h2>
      <ol className="todo">
        {(Object.keys(STAGE_LABEL) as Stage[]).map((s) => (
          <li key={s}><span className={stages[s] === 'done' ? 'ok' : undefined}>{STAGE_LABEL[s]}</span>: <b>{STATE_LABEL[stages[s]]}</b></li>
        ))}
      </ol>
      {extraction ? (
        <>
          <p className="hint">
            Read from a {mb(extraction.fileBytes)} file: {extraction.words.toLocaleString('en')} words in {extraction.paragraphs.toLocaleString('en')} paragraphs, {extraction.tables} table{extraction.tables === 1 ? '' : 's'}, {extraction.chapters.length} chapter{extraction.chapters.length === 1 ? '' : 's'}. {extraction.figures ? `${extraction.figures} figure${extraction.figures === 1 ? '' : 's'} found; images are not read. ` : 'Images are not read. '}Your file stayed in this browser: nothing was uploaded.
          </p>
          {extraction.chapters.length ? (
            <details>
              <summary>Chapters found ({extraction.chapters.length})</summary>
              <ol className="todo">{extraction.chapters.map((c, i) => <li key={i}>{c.title}: {c.words.toLocaleString('en')} words</li>)}</ol>
            </details>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Source({ r, profile }: { r: Result['source']; profile: Profile | null }) {
  const title = profile?.sources.find((s) => s.id === r.source_id)?.title ?? r.source_id;
  return (
    <details>
      <summary>Show the rule</summary>
      <blockquote>{r.quote}</blockquote>
      <p className="hint">{title}{r.page ? `, page ${r.page}` : ''}{r.section ? `, ${r.section}` : ''}</p>
    </details>
  );
}

const Item = ({ r, profile }: { r: Result; profile: Profile | null }) => (
  <div className="item">
    <h3>{r.title}{r.severity === 'blocking' && r.status === 'fail' ? <span className="tag blocking">Required</span> : null}</h3>
    <p>{r.detail}</p>
    {r.examples.length ? <ul className="ex">{r.examples.map((e, i) => <li key={i}>{e}</li>)}</ul> : null}
    <Source r={r.source} profile={profile} />
  </div>
);

function ReportView({ report, profile }: { report: Report; profile: Profile | null }) {
  const by = (s: Result['status']) => report.results.filter((r) => r.status === s);
  const rank = { blocking: 0, major: 1, minor: 2, info: 3 };
  const fails = by('fail').sort((a, b) => rank[a.severity] - rank[b.severity]);
  const reviews = by('review');
  const manual = by('manual');
  const passed = by('pass');
  const skipped = by('skipped');
  return (
    <div className="sheet">
      <h2>{fails.length ? `${fails.length} ${fails.length === 1 ? 'thing' : 'things'} to fix` : 'Nothing to fix so far'}</h2>
      <div className="tally">
        <span><b>{passed.length}</b> rules met</span>
        <span><b>{reviews.length}</b> to look at</span>
        <span><b>{report.conflicts.length}</b> to ask your school</span>
        <span><b>{report.stats.mainWords.toLocaleString('en')}</b> words in the main text</span>
      </div>
      {fails.length ? (
        <section className="group">
          <h2>Fix these</h2>
          {fails.map((r) => <Item key={r.ruleId} r={r} profile={profile} />)}
        </section>
      ) : null}
      {reviews.length ? (
        <section className="group">
          <h2>Look at these yourself</h2>
          <p>Software can only flag these. You make the call.</p>
          {reviews.map((r) => <Item key={r.ruleId} r={r} profile={profile} />)}
        </section>
      ) : null}
      {report.audit.length ? (
        <section className="group">
          <h2>Would your argument survive a reviewer?</h2>
          <p>These checks apply to any university. They flag what to verify, and they do not judge your research.</p>
          {report.audit.map((a) => (
            <div className="item" key={a.id}>
              <h3>{a.title}<span className={a.ok ? 'tag ok' : 'tag'}>{a.ok ? 'Looks fine' : 'Check this'}</span></h3>
              <p>{a.detail}</p>
              {a.examples.length ? <ul className="ex">{a.examples.map((e, i) => <li key={i}>{e}</li>)}</ul> : null}
            </div>
          ))}
        </section>
      ) : null}
      {report.conflicts.length ? (
        <section className="group">
          <h2>Ask your graduate school</h2>
          <p>The official documents disagree on these points, so Supervisor does not mark them right or wrong.</p>
          {report.conflicts.map((c) => (
            <div className="item" key={c.id}>
              <h3>{c.topic}</h3>
              {c.observed ? <p>{c.observed}</p> : null}
              {c.provisional ? <p className="hint">Likely answer: {c.provisional}. {c.provisionalReason}</p> : null}
              <details>
                <summary>Compare the documents</summary>
                {c.options.map((o, i) => (
                  <div key={i}>
                    <blockquote>{o.source.quote}</blockquote>
                    <p className="hint">{profile?.sources.find((s) => s.id === o.source.source_id)?.title}{o.source.page ? `, page ${o.source.page}` : ''}</p>
                  </div>
                ))}
              </details>
            </div>
          ))}
        </section>
      ) : null}
      {report.aiPolicy.status === 'not_found' ? (
        <section className="group">
          <h2>AI use</h2>
          <p>The checked documents state no rule on generative AI. Confirm the current policy with your supervisor and keep a record of how you used AI.</p>
        </section>
      ) : null}
      {manual.length ? (
        <section className="group">
          <h2>Check by hand before you submit</h2>
          {manual.map((r) => <Item key={r.ruleId} r={r} profile={profile} />)}
        </section>
      ) : null}
      {passed.length ? (
        <details className="group">
          <summary>{passed.length} rules met</summary>
          {passed.map((r) => <p key={r.ruleId}><span className="ok">{r.title}.</span> {r.detail}</p>)}
        </details>
      ) : null}
      {skipped.length ? (
        <details>
          <summary>{skipped.length} rules not checked</summary>
          {skipped.map((r) => <p key={r.ruleId}>{r.title}. {r.detail}</p>)}
        </details>
      ) : null}
    </div>
  );
}

export default function CheckPage() {
  const { profiles, profile, profileId, choose, degree, setDegree, loadError, reload } = useProfiles();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'final' | 'blind'>('final');
  const [names, setNames] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [stages, setStages] = useState<Stages | null>(null);
  const [extraction, setExtraction] = useState<Extraction | null>(null);

  /** Everything happens in this browser: the file is read here and the rules are applied here. */
  async function run(e?: React.FormEvent) {
    e?.preventDefault();
    if (!file) return setError('Choose your thesis file first.');
    if (!profile || !degree) return setError(loadError || 'University profiles are still loading. Wait a moment, then try again.');
    if (!file.name.toLowerCase().endsWith('.docx')) return setError('Save the thesis as .docx, then choose it again.');
    setBusy(true);
    setError('');
    setReport(null);
    setExtraction(null);
    try {
      const out = await checkInBrowser(file, profile, { degree, mode, names: names.split(',').map((x) => x.trim()).filter(Boolean) }, (s, x) => {
        setStages(s);
        if (x) setExtraction(x);
      });
      setReport(out.report);
    } catch (x) {
      setError(x instanceof CheckProblem ? x.message : MESSAGES.documentUnreadable);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="desk">
      <form className="cover" onSubmit={run}>
        <h1>Check my thesis</h1>
        <div className="line">
          <label htmlFor="uni">University</label>
          <select id="uni" value={profileId} onChange={(e) => { choose(e.target.value); setReport(null); }}>
            {profiles.map((p) => <option key={p.profile_id} value={p.profile_id}>{p.institution.name}</option>)}
          </select>
        </div>
        <div className="line">
          <label htmlFor="deg">Degree</label>
          <select id="deg" value={degree} onChange={(e) => { setDegree(e.target.value as DegreeType); setReport(null); }}>
            {profile?.scope.degree_types.map((d) => <option key={d} value={d}>{DEGREE_LABELS[d]}</option>)}
          </select>
        </div>
        <div className="line">
          <span className="k">Version</span>
          <div className="modes" role="radiogroup" aria-label="Version">
            <label><input type="radio" name="mode" checked={mode === 'final'} onChange={() => { setMode('final'); setReport(null); }} />Final copy</label>
            <label><input type="radio" name="mode" checked={mode === 'blind'} onChange={() => { setMode('blind'); setReport(null); }} />Blind review</label>
          </div>
        </div>
        {mode === 'blind' ? (
          <div className="line">
            <label htmlFor="names">Names</label>
            <input id="names" value={names} onChange={(e) => setNames(e.target.value)} placeholder="You, your supervisor" />
          </div>
        ) : null}
        <label className={`drop${over ? ' over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) { setFile(f); setError(''); } }}>
          <input type="file" accept=".docx" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(''); }} />
          <span>{file ? file.name : 'Drop your .docx here, or choose a file. It is read in this browser and never uploaded.'}</span>
        </label>
        {error || loadError ? <p className="error" role="alert">{error || loadError}</p> : null}
        {loadError ? <button type="button" className="btn ghost" onClick={() => reload()}>Load the university profiles again</button> : null}
        <button className="btn" disabled={busy}>{busy ? 'Checking…' : 'Check my thesis'}</button>
        {!busy && error && stages && Object.values(stages).includes('failed') ? <button type="button" className="btn ghost" onClick={() => run()}>Try again</button> : null}
      </form>
      <div>
        {stages ? <Progress stages={stages} extraction={extraction} /> : null}
        {report ? <ReportView report={report} profile={profile} /> : stages ? null : (
          <div className="empty">
            <h2>See what a reviewer would send back</h2>
            <p className="lede">Supervisor reads your Word file against your university’s written rules. Every result shows the rule it comes from.</p>
            <ul>
              <li>Format, length, structure and citations</li>
              <li>Names and other clues left in a blind review copy</li>
              <li>Points where the official documents disagree</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
