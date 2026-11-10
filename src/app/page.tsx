'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DraftHelper } from '@/components/DraftHelper';
import { useAccount } from '@/components/useAccount';
import { usePathSync, type SaveStatus } from '@/components/usePathSync';
import { loadAi } from '@/lib/aiSettings';
import { put, useProfiles } from '@/components/useProfiles';
import { CRITIC_NAME } from '@/lib/brand';
import { subtractWorkingDays } from '@/lib/dates';
import type { ImportedFile, StructureId } from '@/lib/path';
import { partsOfStep, STRUCTURES } from '@/lib/structures';
import { addOpenQuestion, aiLogText, applySituation, canComplete, emptyPath, historyOf, isPathState, nextOpen, progress, SITUATIONS, STUCK_DEFAULT, stepRules, stepStages, stepState, STEPS, type CoachReply, type PathState, type StepGuide, type StepState } from '@/lib/path';
import { COACH_LIMIT, count, MAX_UPLOAD_LABEL } from '@/lib/limits';
import { readLocalPath, setAsideFor } from '@/lib/pathSync';
import { SetAsideList } from '@/components/SetAsideList';
import { planRunMerge } from '@/lib/runMerge';
import { withResultsTemplate } from '@/lib/runs';
import { canRetry, errorText, fileProblem, request, requestAi } from '@/lib/request';
import { authHeaders } from '@/lib/supabase';
import { DEGREE_LABELS, type DegreeType } from '@/lib/types';

const KEY = 'path:v1';
const SAVE_TEXT: Record<SaveStatus, (at: Date | null) => string> = {
  idle: () => 'Checking your account…',
  waiting: () => 'Changes not saved to your account yet.',
  saving: () => 'Saving to your account…',
  saved: (at) => `Saved to your account${at ? ` at ${at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}.`,
  unconfirmed: () => 'Not confirmed as saved to your account. Your work is in this browser, and we will keep trying.',
  conflict: () => 'Not saved to your account until you choose a version.',
};
const show = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? v.toLocaleString('en') : JSON.stringify(v));
const VERDICT = { not_ready: 'Not ready', almost: 'Almost there', ready: 'Ready to move on' };
const MARK = { met: '✓', partly: '~', missing: '✗' };
const MARK_LABEL = { met: 'Met', partly: 'Partly met', missing: 'Missing' };

function download(name: string, text: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function PathPage() {
  const { profiles, profile, profileId, choose, degree, setDegree } = useProfiles();
  const { user, ready } = useAccount();
  const [path, setPath] = useState<PathState>(emptyPath);
  const [loaded, setLoaded] = useState(false);
  const [localSaveFailed, setLocalSaveFailed] = useState(false);
  const [question, setQuestion] = useState('');
  const [language, setLanguage] = useState('English');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Phase P4: "Try again" for an AI failure that may pass. The work and the question stay as they are.
  const [retry, setRetry] = useState<(() => void) | null>(null);
  const [panel, setPanel] = useState<'do' | 'write' | 'critique'>('do');
  const [situation, setSituation] = useState('');
  const [startTitle, setStartTitle] = useState('');
  const [startText, setStartText] = useState('');
  const [startFile, setStartFile] = useState('');
  const [stuckOn, setStuckOn] = useState<number | null>(null);
  const [startStructure, setStartStructure] = useState<StructureId>('classic');
  const [drafting, setDrafting] = useState(false);
  const [openNote, setOpenNote] = useState('');
  const [startImport, setStartImport] = useState<ImportedFile | null>(null);
  const [startError, setStartError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [tailoring, setTailoring] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
      if (isPathState(raw)) setPath(raw);
    } catch {}
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) setLocalSaveFailed(!put(KEY, JSON.stringify(path)));
  }, [path, loaded]);

  // Another tab's newer copy replaces this tab's, so an old tab cannot write over it.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEY) return;
      if (e.newValue === null) return setPath(emptyPath());
      try {
        const next = JSON.parse(e.newValue);
        if (isPathState(next)) setPath(next);
      } catch {}
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const replacePath = useCallback((p: PathState) => setPath(p), []);
  const sync = usePathSync({ userId: ready ? user?.id : undefined, loaded, path, replace: replacePath });

  // Every edit stamps the state, and builds on the newest copy in this browser.
  const edit = (u: (p: PathState) => PathState) => {
    setPath((p) => {
      const stored = readLocalPath();
      const latest = stored && (stored.savedAt ?? '') > (p.savedAt ?? '') ? stored : p;
      return { ...u(latest), savedAt: new Date().toISOString() };
    });
  };

  const step = STEPS.find((s) => s.id === path.current) ?? STEPS[0];
  const state = stepState(path, step.id);
  const index = STEPS.indexOf(step);
  const stats = progress(path);
  const rules = stepRules(step, profile, degree);
  const stages = stepStages(step, profile);
  const lead = profile?.rules.find((r) => r.key === 'submission.min_working_days_before_defense')?.value as number | undefined;
  const latest = path.defenseDate && lead ? subtractWorkingDays(new Date(`${path.defenseDate}T12:00:00`), lead) : null;
  const left = step.tasks.length - state.checks.filter((i) => i < step.tasks.length).length;
  const current = step.tasks.findIndex((_, i) => !state.checks.includes(i));

  const patch = (u: Partial<StepState>) => edit((p) => ({ ...p, steps: { ...p.steps, [step.id]: { ...stepState(p, step.id), ...u, updated: new Date().toISOString() } } }));
  const doneTask = () => {
    const next = [...state.checks, current];
    patch({ checks: next });
    if (next.filter((i) => i < step.tasks.length).length >= step.tasks.length) setPanel('write');
  };
  const saveOpenQuestion = () => {
    const next = [...state.checks, current];
    patch({ checks: next, work: addOpenQuestion(state.work, step.tasks[current].do, openNote, step.workTemplate) });
    setStuckOn(null);
    setOpenNote('');
    if (next.filter((i) => i < step.tasks.length).length >= step.tasks.length) setPanel('write');
  };
  const go = (id: string) => { edit((p) => ({ ...p, current: id })); setQuestion(''); setError(''); setDrafting(false); window.scrollTo?.({ top: 0 }); };
  const close = (status: 'done' | 'skipped') => {
    const next = { ...path, steps: { ...path.steps, [step.id]: { ...state, status } } };
    const n = nextOpen(next, step.id);
    edit(() => ({ ...next, current: n?.id ?? step.id }));
    setQuestion('');
    setError('');
    window.scrollTo?.({ top: 0 });
  };

  const panelFor = (id: string): 'do' | 'write' | 'critique' => {
    const st = STEPS.find((x) => x.id === id) ?? STEPS[0];
    const c = stepState(path, id);
    if (c.checks.filter((i) => i < st.tasks.length).length < st.tasks.length) return 'do';
    return c.work.trim() ? 'critique' : 'write';
  };

  useEffect(() => {
    if (loaded && path.started) setPanel(panelFor(path.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path.current, loaded, path.started]);

  useEffect(() => {
    if (panel === 'write' && step.workTemplate) {
      // The template is added to empty notes, or put before notes that hold only runs added from the Lab.
      const next = withResultsTemplate(state.work, step.workTemplate);
      if (next !== null) patch({ work: next });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel, path.current]);

  // With an AI available, each step is tailored once to this student's project.
  useEffect(() => {
    if (!loaded || !path.started || state.guide || state.status !== 'open' || !loadAi()) return;
    tailor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path.current, loaded, path.started]);

  async function tailor() {
    setTailoring(true);
    const id = step.id;
    try {
      const guide = await requestAi<StepGuide>('/api/guide', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ stepId: id, degree, title: path.title, topic: path.topic, discipline: path.discipline, history: historyOf(path, id), language, llm: loadAi() ?? undefined }),
      });
      edit((p) => ({ ...p, steps: { ...p.steps, [id]: { ...stepState(p, id), guide } } }));
    } catch {
      // The standard guidance remains.
    } finally {
      setTailoring(false);
    }
  }

  async function uploadStart(file: File) {
    setStartError('');
    setStartFile('');
    setStartImport(null);
    const tooBig = fileProblem(file);
    if (tooBig) return setStartError(tooBig);
    setUploading(true);
    const f = new FormData();
    f.set('file', file);
    try {
      const j = await request<{ text: string; totalChars: number; extractedChars: number }>('/api/extract', { method: 'POST', body: f });
      setStartText(j.text);
      setStartFile(file.name);
      setStartImport({ file: file.name, extractedChars: j.extractedChars, totalChars: j.totalChars });
    } catch (x) {
      setStartError(errorText(x));
    } finally {
      setUploading(false);
    }
  }

  function begin() {
    edit((p) => ({ ...applySituation(p, situation, { title: startTitle, text: startText, imported: startImport ?? undefined }), structure: startStructure }));
    setStartText('');
  }

  async function askCritic() {
    setBusy(true);
    setError('');
    setRetry(null);
    try {
      const j = await requestAi<CoachReply>('/api/coach', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ stepId: step.id, degree, topic: path.topic, discipline: path.discipline, work: state.work, question, language, history: historyOf(path, step.id), llm: loadAi() ?? undefined }),
      });
      edit((p) => {
        const cur = stepState(p, step.id);
        return {
          ...p,
          steps: { ...p.steps, [step.id]: { ...cur, coach: j, rounds: (cur.rounds ?? 0) + 1 } },
          log: [...p.log, { at: new Date().toISOString(), step: step.id, tool: question ? `${CRITIC_NAME} critique with a question` : `${CRITIC_NAME} critique` }],
        };
      });
      setQuestion('');
    } catch (x) {
      setError(errorText(x));
      if (canRetry(x)) setRetry(() => askCritic);
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

  if (!loaded) return null;

  const download2 = (name: string, p: PathState | null) => download(name, JSON.stringify(p, null, 2), 'application/json');
  const merge = sync.conflict ? planRunMerge(path, sync.conflict.cloud) : null;
  const names = (rs: { name: string }[]) => rs.map((r) => `“${r.name}”`).join(', ');
  const conflictBanner = sync.conflict ? (
    <div className="notice" role="alert" style={{ marginBottom: 16, maxWidth: 'none' }}>
      <p><b>Two versions of your thesis exist.</b> This browser and your account hold different work, so nothing was overwritten. Choose which one to continue with. The other is kept in this browser as a set-aside version. It is never deleted without asking you, and you can download both first.</p>
      {merge?.combinable ? (
        <p style={{ marginTop: 8 }}>
          Only your experiment runs differ: {merge.onlyHere.length} only in this browser, {merge.onlyAccount.length} only in your account. You can keep the runs from both. If you deleted one of them on purpose on another device, delete it again afterwards.
        </p>
      ) : null}
      {merge?.reason === 'edited_both' ? <p style={{ marginTop: 8 }}>These runs were changed in both versions, so they cannot be combined: {names(merge.editedBoth)}. Download both versions before you choose.</p> : null}
      {merge?.editedHereMissingThere.length ? <p style={{ marginTop: 8 }}>Edited in this browser but missing from your account, perhaps deleted on another device: {names(merge.editedHereMissingThere)}.</p> : null}
      {sync.setAsideFull ? (
        <div style={{ marginTop: 8 }}>
          <p><b>This browser already keeps 5 set-aside versions.</b> Nothing was changed. Download a version you may need, or remove one, then choose again.</p>
          <SetAsideList copies={setAsideFor(user?.id)} onChange={() => sync.clearSetAsideFull()} />
        </div>
      ) : null}
      <div className="ask" style={{ marginTop: 10 }}>
        {merge?.combinable && merge.merged ? <button className="btn" disabled={sync.resolving} onClick={() => sync.chooseCombined(merge.merged!)}>Keep the runs from both versions</button> : null}
        <button className={merge?.combinable ? 'btn ghost' : 'btn'} disabled={sync.resolving} onClick={sync.chooseThisBrowser}>Keep this browser’s version</button>
        <button className="btn ghost" disabled={sync.resolving} onClick={sync.chooseAccount}>Use my account’s version</button>
        <button className="btn ghost" onClick={() => download2('supervisor-this-browser.json', path)}>Download this browser’s version</button>
        <button className="btn ghost" disabled={!sync.conflict.cloud} onClick={() => download2('supervisor-account.json', sync.conflict?.cloud ?? null)}>Download my account’s version</button>
      </div>
    </div>
  ) : null;

  const setupFields = (
    <>
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
      <p className="hint">Is your university missing? <Link href="/guides">Add its guide</Link>.</p>
    </>
  );

  const details = (
    <>
      <div className="field">
        <label htmlFor="topic">Topic or title</label>
        <input id="topic" value={path.topic} onChange={(e) => edit((p) => ({ ...p, topic: e.target.value }))} />
      </div>
      {setupFields}
    </>
  );

  if (!path.started) {
    const sit = SITUATIONS.find((x) => x.id === situation);
    return (
      <div className="welcome">
        {conflictBanner}
        <h1>Where are you with your thesis?</h1>
        <p className="lede">Supervisor will start from where you are and guide you to the end. You do the writing.</p>
        <div className="choices" role="radiogroup" aria-label="Where you are now">
          {SITUATIONS.map((x) => (
            <label key={x.id} className={`choice${situation === x.id ? ' on' : ''}`}>
              <input type="radio" name="situation" checked={situation === x.id} onChange={() => setSituation(x.id)} />
              <span><b>{x.label}</b><br /><span className="hint">{x.hint}</span></span>
            </label>
          ))}
        </div>
        {sit ? (
          <div className="sheet form" style={{ marginTop: 18 }}>
            {sit.field ? (
              <div className="field">
                <label htmlFor="start-title">{sit.field}</label>
                <input id="start-title" value={startTitle} onChange={(e) => setStartTitle(e.target.value)} />
              </div>
            ) : null}
            {sit.upload ? (
              <div className="field">
                <label htmlFor="start-file">{sit.upload} (optional)</label>
                <input id="start-file" type="file" accept=".docx,.pdf,.txt" aria-describedby="start-file-help" disabled={uploading} onChange={(e) => e.target.files?.[0] && uploadStart(e.target.files[0])} />
                <p className="hint" id="start-file-help">Word, PDF or text files up to {MAX_UPLOAD_LABEL}.</p>
                {uploading ? <p className="hint" role="status">Reading your file…</p> : null}
                {startFile && !uploading ? <p className="hint ok" role="status">{startFile} is ready. {startImport && startImport.extractedChars < startImport.totalChars ? null : startImport ? `All ${count(startImport.extractedChars)} characters were read.` : null}</p> : null}
                {startImport && startImport.extractedChars < startImport.totalChars && !uploading ? <p className="notice" role="alert">Only part of this file was read: the first {count(startImport.extractedChars)} of {count(startImport.totalChars)} characters. The rest will not be included. To cover it, upload one chapter at a time.</p> : null}
                {startError ? <p className="error" role="alert">{startError}</p> : null}
                <details><summary>Paste text instead</summary><textarea aria-label="Paste your text" value={startText} onChange={(e) => setStartText(e.target.value)} style={{ marginTop: 6 }} /></details>
              </div>
            ) : null}
            <div className="field">
              <label htmlFor="start-structure">Thesis structure</label>
              <select id="start-structure" value={startStructure} onChange={(e) => setStartStructure(e.target.value as StructureId)}>
                {STRUCTURES.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
              <p className="hint">{STRUCTURES.find((x) => x.id === startStructure)?.bestFor} You can change it later.</p>
            </div>
            <details>
              <summary>University and degree</summary>
              <div style={{ marginTop: 10 }}>{setupFields}</div>
            </details>
            <div><button className="btn" disabled={uploading} onClick={begin}>Continue</button></div>
          </div>
        ) : null}
      </div>
    );
  }

  const phases = [...new Set(STEPS.map((s) => s.phase))];

  return (
    <div className="path">
      <aside className="map" aria-label="Your steps">
        <h1>My thesis</h1>
        <div className="meter" role="progressbar" aria-valuenow={stats.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Thesis progress"><span style={{ width: `${stats.percent}%` }} /></div>
        <p className="hint">{stats.closed} of {stats.total} steps finished</p>
        {phases.map((ph) => {
          const items = STEPS.filter((s) => s.phase === ph);
          const closed = items.filter((s) => stepState(path, s.id).status !== 'open').length;
          return (
            <details className="phase" key={`${ph}-${step.phase === ph}`} open={step.phase === ph}>
              <summary>{ph}<span>{closed}/{items.length}</span></summary>
              <ol>
                {items.map((s) => {
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
            </details>
          );
        })}
      </aside>

      <div className="stack">
        {conflictBanner}
        <article className="sheet">
          <p className="hint">Step {index + 1} of {STEPS.length}{step.optional ? ', only if you need it' : ''}</p>
          <h2 className="steptitle">{step.title}</h2>
          <p className="lede">{step.goal}</p>
          {partsOfStep(path, step.id).length ? <p className="hint">This step feeds: <Link href="/document">{partsOfStep(path, step.id).map((x) => x.title).join(', ')}</Link></p> : null}

          {state.imported && state.imported.extractedChars < state.imported.totalChars ? (
            <p className="notice" style={{ margin: '12px 0' }}>Your work here comes from {state.imported.file}, but only its first {count(state.imported.extractedChars)} of {count(state.imported.totalChars)} characters were read. The rest is not in Supervisor.</p>
          ) : null}

          <div className="stages" role="tablist" aria-label="This step">
            {(['do', 'write', 'critique'] as const).map((k, n) => (
              <button key={k} role="tab" aria-selected={panel === k} onClick={() => setPanel(k)}>{n + 1}. {k === 'do' ? 'Do' : k === 'write' ? 'Write' : 'Critique'}</button>
            ))}
          </div>

          {panel === 'do' ? (
            <section className="group">
              {state.guide?.intro ? <p className="notice">{state.guide.intro}</p> : tailoring ? <p className="hint" role="status">Adapting this step to your project…</p> : null}
              {current >= 0 ? (
                <div className="now">
                  <p className="hint">Task {current + 1} of {step.tasks.length}</p>
                  <h3>{step.tasks[current].do}</h3>
                  <p>{state.guide?.tasks[current] ?? step.tasks[current].how}</p>
                  <div className="ask">
                    <button className="btn" onClick={doneTask}>Done, next</button>
                    <button className="btn ghost" aria-expanded={stuckOn === current} onClick={() => { setStuckOn(stuckOn === current ? null : current); setOpenNote(''); }}>I don’t have the answer yet</button>
                  </div>
                  {stuckOn === current ? (
                    <div className="field" style={{ marginTop: 12 }}>
                      <p><b>You can keep going.</b> {step.tasks[current].stuck ?? STUCK_DEFAULT}</p>
                      <label htmlFor="open-note" style={{ marginTop: 8 }}>What do you still need to find out?</label>
                      <textarea id="open-note" value={openNote} onChange={(e) => setOpenNote(e.target.value)} />
                      <p className="hint">We add this to your notes as an open question. Come back to it with your supervisor.</p>
                      <div><button className="btn ghost" disabled={!openNote.trim()} onClick={saveOpenQuestion}>Save my question and continue</button></div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="now">
                  <h3>All tasks are done</h3>
                  <p>Now write down what you found.</p>
                  <button className="btn" onClick={() => setPanel('write')}>Continue</button>
                </div>
              )}
              {step.tool ? <p style={{ marginTop: 10 }}><Link className="btn ghost linkbtn" href={step.tool.href}>{step.tool.label}</Link></p> : null}
              <details>
                <summary>All tasks</summary>
                {step.tasks.map((t, i) => (
                  <div className="task" key={t.do}>
                    <label className="tick">
                      <input type="checkbox" checked={state.checks.includes(i)} onChange={() => patch({ checks: state.checks.includes(i) ? state.checks.filter((x) => x !== i) : [...state.checks, i] })} />
                      <span>{t.do}</span>
                    </label>
                  </div>
                ))}
              </details>
              {step.writingMap ? (
                <details open>
                  <summary>What each part needs from your results</summary>
                  <ul className="todo">{step.writingMap.map((x) => <li key={x.part}><b>{x.part}:</b> {x.needs}</li>)}</ul>
                </details>
              ) : null}
              <details>
                <summary>Common mistakes</summary>
                <ul className="todo">{step.mistakes.map((m) => <li key={m}>{m}</li>)}</ul>
              </details>
              {step.practice?.length ? (
                <details>
                  <summary>Questions committees ask</summary>
                  <ul className="todo">{step.practice.map((x) => <li key={x}>{x}</li>)}</ul>
                </details>
              ) : null}
              {stages.some((x) => x.deadline || x.documents?.length) || rules.length ? (
                <details>
                  <summary>What your university requires</summary>
                  {stages.map((x) => x.deadline || x.documents?.length ? <p key={x.id}>{x.name}{x.deadline ? `: ${x.deadline}` : ''}{x.documents?.length ? `. Documents: ${x.documents.join(', ')}` : ''}</p> : null)}
                  {rules.map((r) => (
                    <div key={r.id} style={{ marginTop: 6 }}>
                      <p>{r.key.split('.').slice(-2).join(' ').replaceAll('_', ' ')}: {show(r.value)}{r.unit ? ` ${r.unit.replaceAll('_', ' ')}` : ''}</p>
                      <blockquote>{r.source.quote}</blockquote>
                    </div>
                  ))}
                </details>
              ) : null}
            </section>
          ) : null}

          {panel === 'write' ? (
            <section className="group">
              <div className="field">
                <label htmlFor="work">{step.workLabel}</label>
                <textarea id="work" value={state.work} onChange={(e) => patch({ work: e.target.value })} placeholder="Use your own words. This saves automatically." />
                {state.work.length > COACH_LIMIT ? <p className="hint">The critique reads the first {count(COACH_LIMIT)} of your {count(state.work.length)} characters. It will not cover the rest.</p> : null}
              </div>
              {drafting ? (
                <DraftHelper
                  key={step.id}
                  stepId={step.id}
                  degree={degree}
                  topic={path.title || path.topic}
                  discipline={path.discipline}
                  history={historyOf(path, step.id)}
                  language={language}
                  lastParagraph={state.work.trim().split(/\n\s*\n/).pop() ?? ''}
                  onUse={(tool) => edit((p) => ({ ...p, log: [...p.log, { at: new Date().toISOString(), step: step.id, tool }] }))}
                />
              ) : null}
              <div className="ask">
                <button className="btn ghost" aria-expanded={drafting} onClick={() => setDrafting(!drafting)}>I don’t know what to write</button>
                <button className="btn" disabled={busy || !state.work.trim()} onClick={() => { setPanel('critique'); askCritic(); }}>{busy ? 'Reading your work…' : 'Get my critique'}</button>
              </div>
            </section>
          ) : null}

          {panel === 'critique' ? (
            <section className="group">
              {!state.coach && !busy && !error ? (
                <div className="now">
                  <h3>{state.work.trim() ? `Ask ${CRITIC_NAME} to read your work` : 'Write your work first'}</h3>
                  <p className="hint">{CRITIC_NAME} judges your work against the standards for this step. It will not write for you.</p>
                </div>
              ) : null}
              {busy ? <p role="status">Reading your work…</p> : null}
              {error ? <p className="error" role="alert" style={{ marginTop: 8 }}>{error}{/Account|Sign in/.test(error) ? <> <Link href="/account">Open Account</Link></> : null}{retry ? <> <button type="button" className="linklike" disabled={busy} onClick={() => retry()}>Try again</button></> : null}</p> : null}
              {state.coach && !busy ? (
                <div className="pen">
                  <p className="verdict">
                    <span className={`badge ${state.coach.verdict}`}>{VERDICT[state.coach.verdict]}</span>
                    <span className="hint">Critique {state.rounds ?? 1}</span>
                  </p>
                  {state.coach.coverage ? (
                    <p className="hint">{state.coach.coverage.complete ? `This critique read all ${count(state.coach.coverage.totalChars)} characters of your work for this step.` : <b>This critique read only the first {count(state.coach.coverage.readChars)} of {count(state.coach.coverage.totalChars)} characters. It says nothing about the rest.</b>}</p>
                  ) : null}
                  <p>{state.coach.summary}</p>
                  {state.coach.weakest ? <p><b>Biggest weakness:</b> {state.coach.weakest}</p> : null}
                  {state.coach.next_action ? <p><b>Do this next:</b> {state.coach.next_action}</p> : null}
                  <details>
                    <summary>See each standard</summary>
                    <ul className="criteria">
                      {state.coach.criteria.map((c) => (
                        <li key={c.standard}>
                          <span className={`mark ${c.status}`} role="img" aria-label={MARK_LABEL[c.status]}>{MARK[c.status]}</span>
                          <span><b>{c.standard}</b>{c.comment ? <><br />{c.comment}</> : null}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                  {state.coach.questions.length ? <><h3>An examiner would ask</h3><ul>{state.coach.questions.map((g) => <li key={g}>{g}</li>)}</ul></> : null}
                  <p className="hint">Your real supervisor has the final say.</p>
                </div>
              ) : null}
              <div className="ask">
                {state.work.trim() ? <button className={state.coach ? 'btn ghost' : 'btn'} disabled={busy} onClick={state.coach ? () => setPanel('write') : askCritic}>{state.coach ? 'Improve my work' : 'Critique my work'}</button> : <button className="btn" onClick={() => setPanel('write')}>Write my work</button>}
                {state.status === 'open' && canComplete(step, state) ? <button className={state.coach ? 'btn' : 'btn ghost'} disabled={busy} onClick={() => close('done')}>Finish, go to the next step</button> : null}
                {state.status === 'open' && step.optional ? <button className="btn ghost" onClick={() => close('skipped')}>Skip this step</button> : null}
                {state.status !== 'open' ? <button className="btn ghost" onClick={() => patch({ status: 'open' })}>Reopen this step</button> : null}
                <select aria-label="Reply language" value={language} onChange={(e) => setLanguage(e.target.value)}>
                  <option>English</option><option>French</option><option>Chinese</option><option>Arabic</option>
                </select>
              </div>
              {state.status === 'open' && !canComplete(step, state) && left > 0 ? <p className="hint" style={{ marginTop: 8 }}>{left} {left === 1 ? 'task' : 'tasks'} left in Do.</p> : null}
            </section>
          ) : null}
        </article>

        <details className="setup">
          <summary>Thesis details and backups</summary>
          <div className="form">
            {details}
            {latest ? <p className="notice">Submit for review by <b>{latest.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</b> at the latest. This counts weekdays only, so public holidays can move it earlier.</p> : null}
            <div className="ask">
              <button className="btn ghost" onClick={() => download('supervisor-progress.json', JSON.stringify(path, null, 2), 'application/json')}>Save a backup</button>
              <button className="btn ghost" onClick={() => fileRef.current?.click()}>Restore a backup</button>
              <button className="btn ghost" onClick={() => download('ai-use-record.txt', aiLogText(path), 'text/plain')}>Download AI use record</button>
              <input ref={fileRef} type="file" accept=".json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) restore(f); e.target.value = ''; }} />
            </div>
          </div>
        </details>
        <p className="hint" role="status">
          {localSaveFailed ? <b>This browser could not save your latest changes. Save a backup below now. </b> : null}
          {user ? SAVE_TEXT[sync.status](sync.savedAt) : <><Link href="/account">Sign in</Link> to keep your work on every device. Until then, it stays in this browser.</>} Text you send for critique goes to the AI service.
        </p>
      </div>
    </div>
  );
}
