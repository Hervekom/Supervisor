'use client';
import { useState } from 'react';
import type { Report, Result } from '@/lib/check';
import { DEGREE_LABELS, type DegreeType, type Profile } from '@/lib/types';
import { useProfiles } from '@/components/useProfiles';

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
  const { profiles, profile, profileId, choose, degree, setDegree, loadError } = useProfiles();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'final' | 'blind'>('final');
  const [names, setNames] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return setError('Choose your thesis file first.');
    setBusy(true);
    setError('');
    const f = new FormData();
    f.set('file', file);
    f.set('profileId', profileId);
    f.set('degree', degree);
    f.set('mode', mode);
    f.set('names', names);
    try {
      const r = await fetch('/api/check', { method: 'POST', body: f });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setReport(j);
    } catch (x) {
      setReport(null);
      setError(x instanceof Error ? x.message : 'The check failed. Try again.');
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
          <span>{file ? file.name : 'Drop your .docx here, or choose a file'}</span>
        </label>
        {error || loadError ? <p className="error" role="alert">{error || loadError}</p> : null}
        <button className="btn" disabled={busy}>{busy ? 'Checking…' : 'Check my thesis'}</button>
      </form>
      <div>
        {report ? <ReportView report={report} profile={profile} /> : (
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
