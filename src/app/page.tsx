'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { put, useProfiles } from '@/components/useProfiles';
import { subtractWorkingDays } from '@/lib/dates';
import { useAccount } from '@/components/useAccount';
import { authHeaders, loadCloudPath, saveCloudPath } from '@/lib/supabase';
import { aiLogText, canComplete, emptyPath, isPathState, newerPath, nextOpen, progress, stepRules, stepStages, stepState, STEPS, type CoachReply, type PathState, type StepState } from '@/lib/path';
import { DEGREE_LABELS, type DegreeType } from '@/lib/types';

const KEY = 'path:v1';
const show = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? v.toLocaleString('en') : JSON.stringify(v));

function download(name: string, text: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function PathPage() {
  const { profiles, profile, profileId, choose, degree, setDegree } = useProfiles();
  const [path, setPath] = useState<PathState>(emptyPath);
  const [loaded, setLoaded] = useState(false);
  const [setupOpen, setSetupOpen] = useState(true);
  const [question, setQuestion] = useState('');
  const [language, setLanguage] = useState('English');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
      if (isPathState(raw)) {
        setPath(raw);
        setSetupOpen(!raw.topic);
      }
    } catch {}
    setLoaded(true);
  }, []);
  const { user, ready } = useAccount();
  const [cloudReady, setCloudReady] = useState(false);
  const [saveState, setSaveState] = useState('');
  const touched = useRef(false);

  useEffect(() => {
    if (!loaded || !ready || !user) return;
    let live = true;
    loadCloudPath(user.id)
      .then((cloud) => {
        if (!live) return;
        const best = newerPath(path, isPathState(cloud) ? cloud : null);
        if (best && best !== path) {
          setPath(best);
          setSetupOpen(!best.topic);
        }
        setCloudReady(true);
      })
      .catch(() => live && setSaveState('Your account could not load. Your work is kept in this browser.'));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, ready, user?.id]);

  useEffect(() => {
    if (!loaded) return;
    put(KEY, JSON.stringify(path));
    if (!user || !cloudReady || !touched.current) return;
    const t = setTimeout(() => {
      saveCloudPath(user.id, path)
        .then(() => setSaveState('Saved to your account'))
        .catch(() => setSaveState('Not saved to your account yet. Your work is kept in this browser.'));
    }, 1200);
    return () => clearTimeout(t);
  }, [path, loaded, user, cloudReady]);

  // Every edit stamps the state, so the newest copy wins across devices.
  const edit = (u: (p: PathState) => PathState) => {
    touched.current = true;
    setPath((p) => ({ ...u(p), savedAt: new Date().toISOString() }));
  };

  const step = STEPS.find((s) => s.id === path.current) ?? STEPS[0];
  const state = stepState(path, step.id);
  const index = STEPS.indexOf(step);
  const stats = progress(path);
  const rules = stepRules(step, profile, degree);
  const stages = stepStages(step, profile);
  const lead = profile?.rules.find((r) => r.key === 'submission.min_working_days_before_defense')?.value as number | undefined;
  const latest = path.defenseDate && lead ? subtractWorkingDays(new Date(`${path.defenseDate}T12:00:00`), lead) : null;

  const patch = (u: Partial<StepState>) =>
    edit((p) => ({ ...p, steps: { ...p.steps, [step.id]: { ...stepState(p, step.id), ...u, updated: new Date().toISOString() } } }));
  const go = (id: string) => { edit((p) => ({ ...p, current: id })); setQuestion(''); setError(''); window.scrollTo?.({ top: 0 }); };
  const close = (status: 'done' | 'skipped') => {
    const next = { ...path, steps: { ...path.steps, [step.id]: { ...state, status } } };
    const n = nextOpen(next, step.id);
    edit(() => ({ ...next, current: n?.id ?? step.id }));
    setQuestion('');
    setError('');
  };

  async function askCoach() {
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/coach', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ stepId: step.id, degree, topic: path.topic, discipline: path.discipline, work: state.work, question, language }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      edit((p) => ({
        ...p,
        steps: { ...p.steps, [step.id]: { ...stepState(p, step.id), coach: j as CoachReply } },
        log: [...p.log, { at: new Date().toISOString(), step: step.id, tool: question ? 'Supervisor review with a question' : 'Supervisor review' }],
      }));
      setQuestion('');
    } catch (x) {
      setError(x instanceof Error ? x.message : 'The review failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function restore(file: File) {
    try {
      const data = JSON.parse(await file.text());
      if (!isPathState(data)) throw new Error();
      edit(() => data);
      setError('');
    } catch {
      setError('This file is not a Supervisor progress file.');
    }
  }

  const phases = [...new Set(STEPS.map((s) => s.phase))];

  return (
    <div className="path">
      <aside className="map" aria-label="Your steps">
        <h1>My thesis</h1>
        <div className="meter" role="progressbar" aria-valuenow={stats.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Thesis progress"><span style={{ width: `${stats.percent}%` }} /></div>
        <p className="hint">{stats.closed} of {stats.total} steps finished</p>
        {phases.map((ph) => (
          <section key={ph}>
            <h2>{ph}</h2>
            <ol>
              {STEPS.filter((s) => s.phase === ph).map((s) => {
                const st = stepState(path, s.id).status;
                return (
                  <li key={s.id}>
                    <button className={`stepbtn ${st}`} aria-current={s.id === step.id ? 'step' : undefined} onClick={() => go(s.id)}>
                      <span aria-hidden="true">{st === 'done' ? '✓' : st === 'skipped' ? '–' : STEPS.indexOf(s) + 1}</span>
                      {s.title}{st === 'done' ? <span className="sr"> (finished)</span> : st === 'skipped' ? <span className="sr"> (skipped)</span> : null}
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </aside>

      <div className="stack">
        <details className="setup" open={setupOpen} onToggle={(e) => setSetupOpen(e.currentTarget.open)}>
          <summary>{path.topic ? path.topic : 'Set up your thesis'}</summary>
          <div className="form">
            <div className="field">
              <label htmlFor="topic">Working title or topic</label>
              <input id="topic" value={path.topic} onChange={(e) => edit((p) => ({ ...p, topic: e.target.value }))} />
            </div>
            <div className="two">
              <div className="field">
                <label htmlFor="uni">University</label>
                <select id="uni" value={profileId} onChange={(e) => choose(e.target.value)}>
                  {profiles.map((p) => <option key={p.profile_id} value={p.profile_id}>{p.institution.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="deg">Degree</label>
                <select id="deg" value={degree} onChange={(e) => setDegree(e.target.value as DegreeType)}>
                  {profile?.scope.degree_types.map((d) => <option key={d} value={d}>{DEGREE_LABELS[d]}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="disc">Discipline</label>
                <input id="disc" value={path.discipline} onChange={(e) => edit((p) => ({ ...p, discipline: e.target.value }))} />
              </div>
              <div className="field">
                <label htmlFor="def">Planned defense date</label>
                <input id="def" type="date" value={path.defenseDate} onChange={(e) => edit((p) => ({ ...p, defenseDate: e.target.value }))} />
              </div>
            </div>
            {latest ? <p className="notice">Submit for review by <b>{latest.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</b> at the latest. This counts weekdays only, so public holidays can move it earlier.</p> : null}
          </div>
        </details>

        <article className="sheet">
          <p className="hint">Step {index + 1} of {STEPS.length}{step.optional ? ', only if you need it' : ''}</p>
          <h2 className="steptitle">{step.title}</h2>
          <p className="lede">{step.goal}</p>

          <section className="group">
            <h3>What to do</h3>
            <ol className="todo">{step.actions.map((a) => <li key={a}>{a}</li>)}</ol>
            {step.tool ? <p style={{ marginTop: 10 }}><Link className="btn ghost linkbtn" href={step.tool.href}>{step.tool.label}</Link></p> : null}
          </section>

          {step.standards?.length ? (
            <section className="group">
              <h3>What strong work shows</h3>
              <ul className="todo">{step.standards.map((x) => <li key={x}>{x}</li>)}</ul>
            </section>
          ) : null}

          {stages.length || rules.length ? (
            <section className="group">
              <h3>What your university requires</h3>
              {stages.map((s) => s.deadline || s.documents?.length ? (
                <p key={s.id}>{s.name}{s.deadline ? `: ${s.deadline}` : ''}{s.documents?.length ? `. Documents: ${s.documents.join(', ')}` : ''}</p>
              ) : null)}
              {rules.map((r) => (
                <details key={r.id}>
                  <summary>{r.key.split('.').slice(-2).join(' ').replaceAll('_', ' ')}: {show(r.value)}{r.unit ? ` ${r.unit.replaceAll('_', ' ')}` : ''}</summary>
                  <blockquote>{r.source.quote}</blockquote>
                </details>
              ))}
            </section>
          ) : null}

          <section className="group">
            <div className="field">
              <label htmlFor="work">{step.workLabel}</label>
              <textarea id="work" value={state.work} onChange={(e) => patch({ work: e.target.value })} placeholder="Write in your own words. This saves automatically." />
            </div>
          </section>

          <section className="group">
            <h3>Talk to your supervisor</h3>
            <div className="field" style={{ marginTop: 8 }}>
              <label htmlFor="q">Your question (optional)</label>
              <input id="q" value={question} onChange={(e) => setQuestion(e.target.value)} />
            </div>
            <div className="ask">
              <button className="btn" disabled={busy} onClick={askCoach}>{busy ? 'Reading…' : 'Review my work'}</button>
              <select aria-label="Reply language" value={language} onChange={(e) => setLanguage(e.target.value)}>
                <option>English</option><option>French</option><option>Chinese</option><option>Arabic</option>
              </select>
            </div>
            {error ? <p className="error" role="alert" style={{ marginTop: 8 }}>{error}</p> : null}
            {state.coach ? (
              <div className="pen">
                <p>{state.coach.assessment}</p>
                {state.coach.gaps.length ? <><h3>What is missing</h3><ul>{state.coach.gaps.map((g) => <li key={g}>{g}</li>)}</ul></> : null}
                {state.coach.questions.length ? <><h3>Think about</h3><ul>{state.coach.questions.map((g) => <li key={g}>{g}</li>)}</ul></> : null}
                {state.coach.next_action ? <p><b>Do this next:</b> {state.coach.next_action}</p> : null}
                {state.coach.ready ? <p className="ok">This looks ready to move on. Confirm with your real supervisor.</p> : null}
              </div>
            ) : null}
          </section>

          <section className="group">
            <h3>Before you move on</h3>
            {step.checks.map((c, i) => (
              <label className="tick" key={c}>
                <input type="checkbox" checked={state.checks.includes(i)} onChange={() => patch({ checks: state.checks.includes(i) ? state.checks.filter((x) => x !== i) : [...state.checks, i] })} />
                {c}
              </label>
            ))}
            <div className="ask">
              {state.status === 'open' ? (
                <>
                  <button className="btn" disabled={!canComplete(step, state)} onClick={() => close('done')}>Finish this step</button>
                  {step.optional ? <button className="btn ghost" onClick={() => close('skipped')}>Skip this step</button> : null}
                  {!canComplete(step, state) ? <span className="hint">Add your work and tick each item to finish.</span> : null}
                </>
              ) : (
                <button className="btn ghost" onClick={() => patch({ status: 'open' })}>Reopen this step</button>
              )}
            </div>
          </section>
        </article>

        <div className="ask">
          <button className="btn ghost" onClick={() => download('supervisor-progress.json', JSON.stringify(path, null, 2), 'application/json')}>Save a backup</button>
          <button className="btn ghost" onClick={() => fileRef.current?.click()}>Restore a backup</button>
          <button className="btn ghost" onClick={() => download('ai-use-record.txt', aiLogText(path), 'text/plain')}>Download AI use record</button>
          <input ref={fileRef} type="file" accept=".json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) restore(f); e.target.value = ''; }} />
        </div>
        <p className="hint" role="status">
          {user ? saveState || 'Your work saves to your account.' : <><Link href="/account">Sign in</Link> to keep your work on every device. Until then, it stays in this browser.</>} Text you send for review goes to the AI service.
        </p>
      </div>
    </div>
  );
}
