'use client';
// P9: practical execution tasks in the Lab. One task is open at a time, and only its current stage is shown.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CopyCommand } from '@/components/CopyCommand';
import {
  cleanExecution, currentReview, emptyEvidence, inputProblem, MAX_TASKS, newTask, prepareSteps, prerequisites, runFromTask, STAGES, submitEvidence,
  suggestTasks, TEMPLATES_BY_ID, type Evidence, type ExecTask, type Instr, type Lang2, type ReviewStatus, type Template,
} from '@/lib/execution';
import { execText, reasonText } from '@/lib/executionText';
import { t as messages, type Lang } from '@/lib/i18n';
import type { LabState } from '@/lib/lab';
import { findSensitive } from '@/lib/labVerify';
import type { PathState } from '@/lib/path';
import { cleanRuns, MAX_RUNS, newRun, stepTitle } from '@/lib/runs';
import { OS_LABELS, type Os } from '@/lib/software';

const tx = (l: Lang2, lang: Lang) => (lang === 'fr' ? l.fr : l.en);
const REVIEW = 7;
const NEXT = 8;

function CodeBlock({ name, body, lang }: { name: string; body: string; lang: Lang }) {
  const x = execText(lang);
  const [copied, setCopied] = useState(false);
  return (
    <div className="exec-code">
      <div className="exec-code-head">
        <b>{name}</b>
        <button type="button" className="btn ghost" aria-label={x.copyText(name)} onClick={async () => { try { await navigator.clipboard.writeText(body); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch {} }}>{copied ? x.copied : x.copy}</button>
      </div>
      <pre tabIndex={0}><code>{body}</code></pre>
    </div>
  );
}

function Steps({ items, lang }: { items: Instr[]; lang: Lang }) {
  const m = messages(lang);
  return (
    <ol className="todo">
      {items.map((s, i) => (
        <li key={i}>
          {tx(s.text, lang)}
          {s.command ? <CopyCommand command={s.command} m={m} /> : null}
          {s.code ? <CodeBlock name={s.code.name} body={s.code.body} lang={lang} /> : null}
        </li>
      ))}
    </ol>
  );
}

function Badge({ status, lang }: { status?: ReviewStatus; lang: Lang }) {
  const x = execText(lang);
  return <span className={`exec-badge ${status ?? 'none'}`}>{status ? x.status[status] : x.notReviewed}</span>;
}

type Props = { path: PathState; lab: LabState; os: Os | null; names: Record<string, string>; editPath: (fn: (p: PathState) => PathState) => void; lang: Lang };

export function ExecutionTasks({ path, lab, os, names, editPath, lang }: Props) {
  const x = execText(lang);
  const m = messages(lang);
  const tasks = cleanExecution(path.execution).tasks;
  const [openId, setOpenId] = useState<string | null>(null);
  const [small, setSmall] = useState(false);

  useEffect(() => {
    setSmall(window.matchMedia('(max-width: 720px)').matches);
    // My thesis links here with ?task=<template> to open or start a task for a step.
    const want = new URLSearchParams(window.location.search).get('task');
    if (want && TEMPLATES_BY_ID[want] && path.started) {
      const found = cleanExecution(path.execution).tasks.find((t) => t.template === want);
      if (found) setOpenId(found.id);
      else if (suggestTasks(lab).some((t) => t.id === want)) start(TEMPLATES_BY_ID[want]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setTasks = (fn: (t: ExecTask[]) => ExecTask[]) => editPath((p) => ({ ...p, execution: { tasks: fn(cleanExecution(p.execution).tasks) } }));
  const saveTask = (task: ExecTask) => setTasks((ts) => ts.map((t) => (t.id === task.id ? task : t)));
  function start(tpl: Template) {
    const existing = tasks.find((t) => t.template === tpl.id);
    if (existing) return setOpenId(existing.id);
    if (tasks.length >= MAX_TASKS) return;
    const task = newTask(tpl.id);
    setTasks((ts) => (ts.some((t) => t.template === tpl.id) ? ts : [...ts, task]));
    setOpenId(task.id);
  }

  const head = (
    <>
      <h2 style={{ marginTop: 28 }} id="tasks-title">{x.title}</h2>
      <p className="hint">{x.intro}</p>
    </>
  );
  if (!path.started) {
    return (
      <section id="tasks" aria-labelledby="tasks-title" className="exec">
        {head}
        <p className="empty">{x.needThesis} <Link href="/">{m.startThesis}</Link></p>
      </section>
    );
  }
  if (!lab.workTypes.length) {
    return (
      <section id="tasks" aria-labelledby="tasks-title" className="exec">
        {head}
        <p className="empty">{x.chooseFirst}</p>
      </section>
    );
  }

  const suggested = suggestTasks(lab);
  const open = tasks.find((t) => t.id === openId);

  return (
    <section id="tasks" aria-labelledby="tasks-title" className="exec">
      {head}
      {open ? (
        <TaskView key={open.id} task={open} lab={lab} os={os} names={names} small={small} lang={lang} path={path} editPath={editPath} save={saveTask}
          remove={() => { setTasks((ts) => ts.filter((t) => t.id !== open.id)); setOpenId(null); }}
          close={() => setOpenId(null)}
          openNext={(tpl) => start(tpl)}
          suggested={suggested} tasks={tasks} />
      ) : (
        <>
          {tasks.length ? (
            <>
              <h3>{x.yourTasks}</h3>
              <ul className="exec-list">
                {tasks.map((t) => {
                  const tpl = TEMPLATES_BY_ID[t.template];
                  const r = currentReview(t);
                  return (
                    <li key={t.id} className="sheet exec-item">
                      <div>
                        <b>{tx(tpl.title, lang)}</b>
                        <p className="hint" data-testid={`task-status-${t.template}`}>{x.taskStatus(r ? x.status[r.status] : x.noEvidence, t.stage + 1)}</p>
                      </div>
                      <button type="button" className="btn ghost" aria-label={x.openTask(tx(tpl.title, lang))} onClick={() => setOpenId(t.id)}>{x.open}</button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
          <h3>{x.suggested}</h3>
          {suggested.length ? (
            <ul className="exec-list">
              {suggested.filter((tpl) => !tasks.some((t) => t.template === tpl.id)).map((tpl) => (
                <li key={tpl.id} className="sheet exec-item">
                  <div>
                    <b>{tx(tpl.title, lang)}</b>
                    <p className="hint">{tx(tpl.objective, lang)}</p>
                    <p className="exec-tags"><span className={`tag res-${tpl.resource}`}>{x.resource[tpl.resource]}</span><span className="tag">{x.type[tpl.type]}</span><span className="tag">{stepTitle(tpl.steps[0], lang)}</span></p>
                  </div>
                  <button type="button" className="btn" disabled={tasks.length >= MAX_TASKS} onClick={() => start(tpl)}>{x.start}</button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">{x.noneSuggested}</p>
          )}
          {tasks.length >= MAX_TASKS ? <p className="notice" role="status">{x.limit}</p> : null}
        </>
      )}
    </section>
  );
}

type ViewProps = {
  task: ExecTask; lab: LabState; os: Os | null; names: Record<string, string>; small: boolean; lang: Lang; path: PathState;
  editPath: Props['editPath']; save: (t: ExecTask) => void; remove: () => void; close: () => void; openNext: (t: Template) => void; suggested: Template[]; tasks: ExecTask[];
};

function TaskView({ task, lab, os, names, small, lang, path, editPath, save, remove, close, openNext, suggested, tasks }: ViewProps) {
  const x = execText(lang);
  const m = messages(lang);
  const tpl = TEMPLATES_BY_ID[task.template];
  const review = currentReview(task);
  const stale = !!task.review && !review;
  // Evidence being typed lives only in memory until it is checked. A stored copy is never re-checked silently.
  const [ev, setEv] = useState<Evidence>(() => ({ ...emptyEvidence(), counts: { ...task.evidence.counts }, confirmed: [...task.evidence.confirmed], config: task.evidence.config, files: task.evidence.files, metrics: task.evidence.metrics, screenshots: task.evidence.screenshots }));
  const [problem, setProblem] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [runNote, setRunNote] = useState('');
  const stage = task.stage;
  const reached = review ? NEXT : 6;
  const go = (n: number) => {
    save({ ...task, stage: Math.max(0, Math.min(n, reached)), updatedAt: new Date().toISOString() });
    setProblem('');
    requestAnimationFrame(() => document.getElementById('task-stage')?.focus());
  };
  const runnable = !!os && (!tpl.os || tpl.os.includes(os));
  const inputErrors = tpl.inputs.map((f) => inputProblem(f, task.inputs[f.id] ?? ''));
  const inputsOk = inputErrors.every((e) => !e);
  const pre = prerequisites(tpl, lab, new Set(Object.keys(names)));
  const unverified = pre.filter((p) => p.status !== 'verified');
  const canContinue = stage === 4 ? inputsOk : stage === 2 || stage === 5 ? runnable : true;

  function check() {
    if (!os) return setProblem(x.chooseSystem);
    const r = submitEvidence(task, ev, { os });
    if (!r.ok) return setProblem(r.problem === 'secret' ? x.secret : r.problem === 'too_long' ? x.tooLong : x.badInputs);
    setProblem('');
    save(r.task);
    setEv((e) => ({ ...e, output: '', output2: '', errors: '' }));
  }

  function saveRun() {
    const draft = runFromTask(task);
    if (!draft) return;
    const runs = cleanRuns(path.runs);
    if (task.runId && runs.some((r) => r.id === task.runId)) return setRunNote(x.runExists);
    if (runs.length >= MAX_RUNS) return setRunNote(x.runFull);
    const run = newRun(draft);
    editPath((p) => ({
      ...p,
      runs: [...cleanRuns(p.runs), run],
      execution: { tasks: cleanExecution(p.execution).tasks.map((t) => (t.id === task.id ? { ...t, runId: run.id, updatedAt: run.createdAt } : t)) },
    }));
    setRunNote(x.runSaved);
  }

  const evField = (k: 'output' | 'output2' | 'metrics' | 'config' | 'files' | 'errors' | 'screenshots', rows: number) => {
    const id = `ev-${k}`;
    const v = ev[k];
    const sens = findSensitive(v);
    return (
      <div className="field" key={k}>
        <label htmlFor={id}><b>{x.ev[k]}</b></label>
        <p className="hint" id={`${id}-hint`}>{x.evHint[k]}</p>
        <textarea id={id} aria-describedby={`${id}-hint`} rows={rows} value={v} spellCheck={false} autoCapitalize="off" autoCorrect="off" className={k === 'output' || k === 'output2' || k === 'errors' ? 'mono' : undefined} onChange={(e) => setEv((p) => ({ ...p, [k]: e.target.value }))} />
        {sens.length ? <p className="notice" role="alert">{sens.includes('secret') ? x.secret : x.sensitive}</p> : null}
      </div>
    );
  };

  const nextTpl = suggested.find((s) => s.id !== tpl.id && !tasks.some((t) => t.template === s.id && currentReview(t)?.status === 'verified'));

  let body: React.ReactNode = null;
  if (stage === 0) {
    body = (
      <>
        <h4>{x.objective}</h4>
        <p>{tx(tpl.objective, lang)}</p>
        <p className="hint"><b>{x.forStep}</b> {stepTitle(task.stepId, lang)}{tpl.steps.length > 1 ? ` (${tpl.steps.slice(1).map((s) => stepTitle(s, lang)).join(', ')})` : ''}</p>
        <h4>{x.whyPc}</h4>
        <p>{tx(tpl.why, lang)}</p>
        {small ? <p className="notice" role="note" data-testid="phone-note">{tpl.resource === 'light' ? x.phoneOk : x.phoneNote}</p> : null}
      </>
    );
  } else if (stage === 1) {
    body = (
      <>
        <h4>{x.tools}</h4>
        {pre.length ? (
          <ul className="exec-tools">
            {pre.map((p) => (
              <li key={p.id}>
                <b>{names[p.id] ?? p.id}</b> <span className={`lab-badge ${p.status}`}>{m.status[p.status]}</span>
              </li>
            ))}
          </ul>
        ) : <p className="hint">{x.noTools}</p>}
        <p><a href="#checklist">{x.toChecklist}</a></p>
      </>
    );
  } else if (stage === 2) {
    body = !os ? <p className="notice">{x.chooseSystem}</p> : !runnable ? <p className="notice" role="alert">{x.notOnSystem(OS_LABELS[os])}</p> : (
      <>
        <Steps items={prepareSteps(tpl.env, os)} lang={lang} />
        <h4>{x.configure}</h4>
        <p>{tx(tpl.config, lang)}</p>
      </>
    );
  } else if (stage === 3) {
    body = (
      <>
        {!pre.length ? <p>{x.noTools}</p> : !unverified.length ? <p className="exec-ok" role="status">{x.allVerified}</p> : (
          <>
            <p className="notice" role="status">{x.notVerified(unverified.length)}</p>
            <ul className="exec-tools">{unverified.map((p) => <li key={p.id}><b>{names[p.id] ?? p.id}</b> <span className={`lab-badge ${p.status}`}>{m.status[p.status]}</span></li>)}</ul>
            <p><a href="#checklist">{x.toChecklist}</a></p>
          </>
        )}
      </>
    );
  } else if (stage === 4) {
    body = tpl.inputs.length ? (
      <>
        <p className="hint">{x.inputsHint}</p>
        {tpl.inputs.map((f, i) => {
          const id = `in-${f.id}`;
          const err = inputErrors[i];
          return (
            <div className="field" key={f.id}>
              <label htmlFor={id}><b>{tx(f.label, lang)}</b></label>
              {f.hint ? <p className="hint" id={`${id}-hint`}>{tx(f.hint, lang)}</p> : null}
              <input id={id} value={task.inputs[f.id] ?? ''} placeholder={f.placeholder} aria-invalid={!!err && !!(task.inputs[f.id] ?? '').trim()} aria-describedby={f.hint ? `${id}-hint` : undefined} spellCheck={false} autoCapitalize="off" autoCorrect="off"
                onChange={(e) => save({ ...task, inputs: { ...task.inputs, [f.id]: e.target.value.slice(0, 200) }, updatedAt: new Date().toISOString() })} />
              {err === 'unsafe' ? <p className="hint warn" role="alert">{x.unsafe}</p> : err === 'missing' ? <p className="hint">{x.missing}</p> : null}
            </div>
          );
        })}
        {!inputsOk ? <p className="hint">{x.fixInputs}</p> : null}
      </>
    ) : <p className="hint">{x.noInputs}</p>;
  } else if (stage === 5) {
    body = !os ? <p className="notice">{x.chooseSystem}</p> : !runnable ? <p className="notice" role="alert">{x.notOnSystem(OS_LABELS[os])}</p> : (
      <>
        <Steps items={tpl.execute(inputsOk ? task.inputs : {}, os)} lang={lang} />
        <p className="hint"><b>{x.expected}</b> {tx(tpl.expected, lang)}</p>
        <details>
          <summary>{x.risks}</summary>
          <ul className="todo">{tpl.risks.map((r) => <li key={r.problem.en}><b>{tx(r.problem, lang)}.</b> {tx(r.fix, lang)}</li>)}</ul>
        </details>
      </>
    );
  } else if (stage === 6) {
    body = (
      <>
        {tpl.evidence.map((k) => evField(k, k === 'output' || k === 'output2' ? 8 : 3))}
        {tpl.counts?.length ? (
          <fieldset className="field">
            <legend><b>{x.counts}</b></legend>
            <div className="exec-counts">
              {tpl.counts.map((c) => (
                <label key={c.id}>
                  {tx(c.label, lang)}
                  <input inputMode="numeric" value={ev.counts[c.id] ?? ''} onChange={(e) => setEv((p) => ({ ...p, counts: { ...p.counts, [c.id]: e.target.value.slice(0, 12) } }))} />
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        {tpl.confirmations?.length ? (
          <fieldset className="field">
            <legend><b>{x.confirm}</b></legend>
            {tpl.confirmations.map((c) => (
              <label key={c.id} className="choice">
                <input type="checkbox" checked={ev.confirmed.includes(c.id)} onChange={() => setEv((p) => ({ ...p, confirmed: p.confirmed.includes(c.id) ? p.confirmed.filter((y) => y !== c.id) : [...p.confirmed, c.id] }))} />
                <span>{tx(c.label, lang)}</span>
              </label>
            ))}
          </fieldset>
        ) : null}
        <p className="hint">{x.checkNote}</p>
        <div className="lab-actions"><button type="button" className="btn" onClick={check}>{x.check}</button></div>
        {problem ? <p className="notice" role="alert">{problem}</p> : null}
      </>
    );
  } else if (stage === REVIEW) {
    body = !review ? <p className="hint">{stale ? x.stale : x.notReviewed}</p> : (
      <>
        <div className={`exec-result ${review.status}`} role="status" data-testid="exec-review">
          <p><Badge status={review.status} lang={lang} /></p>
          <p>{x.statusLine[review.status]}</p>
          <ul className="exec-reasons">
            {review.reasons.map((c) => {
              const r = reasonText(c, lang);
              return <li key={c}>{r.text}{r.next ? <> <b>{m.next}</b> {r.next}</> : null}</li>;
            })}
          </ul>
          <p className="hint">{x.checkedOn(review.at.slice(0, 10))}</p>
        </div>
        {review.found.length ? (
          <>
            <h4>{x.found}</h4>
            <dl className="exec-found">{review.found.map(([k, v]) => <div key={k}><dt>{x.foundLabel[k] ?? k}</dt><dd>{v}</dd></div>)}</dl>
          </>
        ) : null}
        {review.metrics.length ? (
          <>
            <h4>{x.metricsRead}</h4>
            <dl className="exec-found">{review.metrics.map((mt) => <div key={mt.name}><dt>{mt.name}</dt><dd>{String(mt.value)}</dd></div>)}</dl>
          </>
        ) : null}
        {review.trimmed ? <p className="hint">{x.trimmed(review.chars ?? 0)}</p> : null}
        <details>
          <summary>{x.criteria}</summary>
          <ul className="todo">{tpl.criteria.map((c) => <li key={c.en}>{tx(c, lang)}</li>)}</ul>
        </details>
        <p><button type="button" className="btn ghost" onClick={() => go(6)}>{x.submitAgain}</button></p>
      </>
    );
  } else {
    const st = review?.status;
    body = !review ? <p className="hint">{x.notReviewed}</p> : (
      <>
        <p>{x.nextFor[st!]}</p>
        <div className="lab-actions">
          {runFromTask(task) ? <button type="button" className="btn" onClick={saveRun}>{x.saveRun}</button> : null}
          {st === 'failed' || st === 'incomplete' ? <button type="button" className="btn" onClick={() => go(st === 'failed' ? 5 : 6)}>{st === 'failed' ? x.stages[5] : x.submitAgain}</button> : null}
          {st === 'verified' && nextTpl ? <button type="button" className="btn ghost" onClick={() => openNext(nextTpl)}>{x.nextTask(tx(nextTpl.title, lang))}</button> : null}
          <Link className="btn ghost linkbtn" href="/">{x.goStep}</Link>
        </div>
        {runNote ? <p className="hint" role="status">{runNote}</p> : null}
      </>
    );
  }

  return (
    <article className="sheet exec-task" aria-labelledby="task-title" data-testid="exec-task">
      <div className="lab-head">
        <h3 id="task-title">{tx(tpl.title, lang)}</h3>
        <button type="button" className="btn ghost" onClick={close}>{x.close}</button>
      </div>
      <p className="exec-tags"><span className={`tag res-${tpl.resource}`}>{x.resource[tpl.resource]}</span><span className="tag">{x.type[tpl.type]}</span><Badge status={review?.status} lang={lang} /></p>
      <nav aria-label={x.progress}>
        <ol className="exec-stages">
          {STAGES.map((s, i) => (
            <li key={s} className={i === stage ? 'cur' : i < stage ? 'done' : ''}>
              <button type="button" aria-current={i === stage ? 'step' : undefined} disabled={i > reached} onClick={() => go(i)}>
                <span aria-hidden="true">{i + 1}</span><span className="exec-stage-name">{x.stages[i]}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <section className="exec-stage" aria-labelledby="task-stage" data-stage={STAGES[stage]}>
        <p className="hint">{x.stageOf(stage + 1)}</p>
        <h4 id="task-stage" tabIndex={-1}>{x.stages[stage]}</h4>
        {body}
      </section>
      <div className="lab-actions exec-nav">
        {stage > 0 ? <button type="button" className="btn ghost" onClick={() => go(stage - 1)}>{x.back}</button> : null}
        {stage < 6 ? <button type="button" className="btn" disabled={!canContinue} onClick={() => go(stage + 1)}>{x.continue}</button> : null}
        {stage === REVIEW && review ? <button type="button" className="btn" onClick={() => go(NEXT)}>{x.continue}</button> : null}
      </div>
      <div className="exec-remove">
        {!confirmDelete ? <button type="button" className="btn ghost" onClick={() => setConfirmDelete(true)}>{x.remove}</button> : <button type="button" className="btn ghost danger" onClick={remove}>{x.removeConfirm}</button>}
      </div>
    </article>
  );
}

/** On My thesis: the practical tasks that fit the current step and the student's method. */
export function StepTasks({ stepId, path }: { stepId: string; path: PathState }) {
  const x = execText('en');
  const lab = path.lab;
  if (!lab || !Array.isArray(lab.workTypes) || !lab.workTypes.length) return null;
  const list = suggestTasks({ workTypes: lab.workTypes, os: lab.os ?? null, gpu: lab.gpu ?? 'not_sure' }, stepId);
  if (!list.length) return null;
  const tasks = cleanExecution(path.execution).tasks;
  return (
    <section className="sheet exec-step" aria-labelledby="step-tasks-title" data-testid="step-tasks">
      <h3 id="step-tasks-title">{x.forThisStep}</h3>
      <p className="hint">{x.forThisStepHint}</p>
      <ul className="todo">
        {list.map((t) => {
          const mine = tasks.find((k) => k.template === t.id);
          const r = mine && currentReview(mine);
          return (
            <li key={t.id}>
              <Link href={`/lab?task=${t.id}#tasks`}>{t.title.en}</Link> <span className={`tag res-${t.resource}`}>{x.resource[t.resource]}</span>
              {mine ? <span className="hint"> {r ? x.status[r.status] : x.stageOf(mine.stage + 1)}</span> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
