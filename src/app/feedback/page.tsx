'use client';
import { useState } from 'react';
import { useProfiles } from '@/components/useProfiles';
import type { Feedback } from '@/lib/feedback';
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

export default function FeedbackPage() {
  const { profile, degree, setDegree } = useProfiles();
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

  async function load(file: File) {
    setError('');
    const f = new FormData();
    f.set('file', file);
    const r = await fetch('/api/chapters', { method: 'POST', body: f });
    const j = await r.json();
    if (!r.ok) return setError(j.error);
    setChapters(j.chapters);
    setRefs(j.references.join('\n'));
    if (j.chapters[0]) {
      setTitle(j.chapters[0].title);
      setText(j.chapters[0].text);
    } else setError('No chapters were found. Paste a chapter below.');
  }

  async function post<T>(url: string, body: unknown, done: (j: T) => void) {
    setBusy(true);
    setError('');
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(await authHeaders()) }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      done(j);
    } catch (x) {
      setError(x instanceof Error ? x.message : 'The request failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Feedback on your writing</h1>
      <p className="lede">You write the thesis. Supervisor reads it, points out weak spots and asks the questions a good supervisor would ask.</p>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'chapter'} onClick={() => setTab('chapter')}>Chapter</button>
        <button role="tab" aria-selected={tab === 'refs'} onClick={() => setTab('refs')}>References</button>
      </div>
      <div className="form">
        <div className="field">
          <label htmlFor="f">Thesis file (optional)</label>
          <input id="f" type="file" accept=".docx" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
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
            ) : null}
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
            </div>
            <div><button className="btn" disabled={busy} onClick={() => post<Feedback>('/api/feedback', { degree, discipline, title, text, language }, setFeedback)}>{busy ? 'Reading…' : 'Get feedback'}</button></div>
          </>
        ) : (
          <>
            <div className="field">
              <label htmlFor="r">References, one per line</label>
              <textarea id="r" value={refs} onChange={(e) => setRefs(e.target.value)} />
            </div>
            <div><button className="btn" disabled={busy} onClick={() => post<{ results: RefResult[] }>('/api/references', { entries: refs.split('\n') }, (j) => setRefResults(j.results))}>{busy ? 'Checking…' : 'Check references'}</button></div>
          </>
        )}
        {error ? <p className="error" role="alert">{error}</p> : null}
      </div>
      {tab === 'chapter' && feedback ? (
        <div className="sheet" style={{ marginTop: 24, maxWidth: 820 }}>
          <h2>What your supervisor would say</h2>
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
        </div>
      ) : null}
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
