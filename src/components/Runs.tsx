'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { loadAi } from '@/lib/aiSettings';
import { fill, PHASES_FR, t as messages, type Lang, type Messages } from '@/lib/i18n';
import { cleanLab } from '@/lib/lab';
import { findSensitive } from '@/lib/labVerify';
import { stepState, STEPS, type PathState } from '@/lib/path';
import { errorText, request } from '@/lib/request';
import type { RunFeedback } from '@/lib/runFeedback';
import { maybePii } from '@/lib/pii';
import { appendToResultsSheet, cleanDraft, cleanRuns, emptyDraft, fmt, isStepId, newRun, parseMetricsFile, parseNumber, runProblems, runToText, SPLITS, stepTitle, summarize, versionsFromLab, type Metric, type RunDraft, type RunRecord, type Split } from '@/lib/runs';
import type { Os } from '@/lib/software';
import { authHeaders } from '@/lib/supabase';

type Row = { name: string; value: string; split: Split };
type Form = Omit<RunDraft, 'metrics'> & { rows: Row[] };
/** The run filter: every step, runs without a step, or one step ID. */
export type StepFilter = 'all' | 'none' | string;

const toForm = (d: RunDraft): Form => ({ ...d, rows: d.metrics.map((m) => ({ name: m.name, value: String(m.value), split: m.split })) });
const PHASES = [...new Set(STEPS.map((s) => s.phase))];
const phaseName = (p: string, lang: Lang) => (lang === 'fr' ? PHASES_FR[p] ?? p : p);
const num = (n: number, lang: Lang, digits?: number) => (lang === 'fr' ? fmt(n, digits).replace('.', ',') : fmt(n, digits));

function toDraft(f: Form, lang: Lang): { draft: RunDraft; problems: string[] } {
  const p = messages(lang).problems;
  const problems: string[] = [];
  const metrics: Metric[] = [];
  for (const r of f.rows) {
    if (!r.name.trim() && !r.value.trim()) continue;
    const v = parseNumber(r.value);
    if (!r.name.trim()) problems.push(p.resultName);
    else if (v === null) problems.push(fill(p.resultNumber, { name: r.name }));
    else metrics.push({ name: r.name, value: v, split: r.split });
  }
  const { rows: _rows, ...rest } = f;
  const draft = cleanDraft({ ...rest, metrics });
  return { draft, problems: [...problems, ...runProblems(draft, lang)] };
}

function Field({ label, hint, value, onChange, area, id }: { label: string; hint?: string; value: string; onChange: (v: string) => void; area?: boolean; id: string }) {
  return (
    <div className="field">
      <label htmlFor={id}><b>{label}</b></label>
      {hint ? <p className="hint" id={`${id}-hint`}>{hint}</p> : null}
      {area ? (
        <textarea id={id} aria-describedby={hint ? `${id}-hint` : undefined} value={value} onChange={(e) => onChange(e.target.value)} rows={3} />
      ) : (
        <input id={id} type="text" aria-describedby={hint ? `${id}-hint` : undefined} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

/** All 21 steps, grouped by phase. Their IDs and order come from the thesis path and never change. */
function StepSelect({ id, value, onChange, lang, label, includeAll, counts }: { id: string; value: string; onChange: (v: string) => void; lang: Lang; label?: string; includeAll?: boolean; counts?: Record<string, number> }) {
  const m = messages(lang);
  const n = (k: string) => (counts ? ` (${counts[k] ?? 0})` : '');
  return (
    <select id={id} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {includeAll ? <option value="all">{m.filterAll}{counts ? ` (${counts.all ?? 0})` : ''}</option> : null}
      <option value={includeAll ? 'none' : ''}>{m.unassigned}{n('none')}</option>
      {PHASES.map((p) => (
        <optgroup key={p} label={phaseName(p, lang)}>
          {STEPS.filter((s) => s.phase === p).map((s) => <option key={s.id} value={s.id}>{stepTitle(s.id, lang)}{n(s.id)}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

function RunForm({ initial, onSave, onCancel, lang }: { initial: RunDraft; onSave: (d: RunDraft) => void; onCancel: () => void; lang: Lang }) {
  const m = messages(lang);
  const [f, setF] = useState<Form>(() => toForm(initial));
  const [problems, setProblems] = useState<string[]>([]);
  const [fileNote, setFileNote] = useState('');
  // Rows read from a file without a split. The student may give them one; "not specified" stays as it is.
  const [unsplit, setUnsplit] = useState<number[]>([]);
  const [fileSplit, setFileSplit] = useState<Split>('other');
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const setRow = (i: number, r: Partial<Row>) => setF((x) => ({ ...x, rows: x.rows.map((row, k) => (k === i ? { ...row, ...r } : row)) }));
  const hidden = findSensitive(`${f.log}\n${f.notes}\n${f.settings}\n${f.hardware}`);
  const field = (k: keyof typeof m.fields, area = false) => (
    <Field id={`run-${k}`} label={m.fields[k][0]} hint={m.fields[k][1] || undefined} value={String(f[k as keyof Form] ?? '')} onChange={(v) => set(k as keyof Form, (k === 'log' ? v.slice(0, 2000) : v) as never)} area={area} />
  );

  async function importFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 50_000) return setFileNote(m.fileProblems.tooLarge);
    const { metrics, problems: p } = parseMetricsFile(file.name, await file.text(), lang);
    if (metrics.length) setF((x) => {
      const kept = x.rows.filter((r) => r.name.trim() || r.value.trim());
      setUnsplit(metrics.flatMap((mm, i) => (mm.split === 'other' ? [kept.length + i] : [])));
      setFileSplit('other');
      return { ...x, rows: [...kept, ...metrics.map((mm) => ({ name: mm.name, value: String(mm.value), split: mm.split }))] };
    });
    setFileNote([metrics.length ? m.fileRead(metrics.length, file.name) : '', ...p].filter(Boolean).join(' '));
  }

  function save() {
    const { draft, problems: p } = toDraft(f, lang);
    setProblems(p);
    if (!p.length) onSave(draft);
  }

  return (
    <div className="sheet run-form">
      <div className="choices row" role="radiogroup" aria-label={m.outcomeAria}>
        {(['completed', 'failed'] as const).map((o) => (
          <label key={o} className="choice">
            <input type="radio" name="outcome" checked={f.outcome === o} onChange={() => set('outcome', o)} />
            <span>{o === 'completed' ? m.outcomeCompleted : m.outcomeFailed}</span>
          </label>
        ))}
      </div>
      <div className="field">
        <label htmlFor="run-step"><b>{m.fields.step[0]}</b></label>
        <p className="hint" id="run-step-hint">{m.fields.step[1]}</p>
        <StepSelect id="run-step" value={f.stepId ?? ''} lang={lang} onChange={(v) => setF((x) => {
          const { stepId: _old, ...rest } = x;
          return isStepId(v) ? { ...rest, stepId: v } : rest;
        })} />
      </div>
      {field('name')}
      {field('purpose')}
      <div className="run-grid">
        {field('dataset')}
        {field('split')}
        {field('model')}
        {field('seeds')}
        {field('hardware')}
        {field('duration')}
      </div>
      {field('versions')}
      {field('settings', true)}

      <fieldset className="field">
        <legend><b>{m.resultsLegend}</b></legend>
        <p className="hint">{m.resultsHint}</p>
        <div className="metric-rows">
          {f.rows.map((r, i) => (
            <div key={i} className="metric-row">
              <input type="text" aria-label={m.resultName(i + 1)} placeholder="accuracy" value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} />
              <input type="text" inputMode="decimal" aria-label={m.resultValue(i + 1)} placeholder={lang === 'fr' ? '0,91' : '0.91'} value={r.value} onChange={(e) => setRow(i, { value: e.target.value })} />
              <select aria-label={m.resultSplit(i + 1)} value={r.split} onChange={(e) => setRow(i, { split: e.target.value as Split })}>
                {SPLITS.map((s) => <option key={s} value={s}>{m.splits[s]}</option>)}
              </select>
              <button type="button" className="btn ghost" aria-label={m.removeResult(i + 1)} onClick={() => { setUnsplit([]); setF((x) => ({ ...x, rows: x.rows.filter((_, k) => k !== i) })); }}>{m.remove}</button>
            </div>
          ))}
        </div>
        <div className="lab-actions">
          <button type="button" className="btn ghost" onClick={() => setF((x) => ({ ...x, rows: [...x.rows, { name: '', value: '', split: 'test' }] }))}>{m.addResult}</button>
          <label className="btn ghost file-btn">
            {m.readFile}
            <input type="file" accept=".csv,.json,text/csv,application/json" onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        </div>
        <p className="hint">{m.fileHint}</p>
        {fileNote ? <p className="hint" role="status">{fileNote}</p> : null}
        {unsplit.length ? (
          <div className="field">
            <p className="hint" id="run-file-split-hint">{m.fileNoSplit(unsplit.length)}</p>
            <label htmlFor="run-file-split"><b>{m.fileSplitLabel}</b></label>
            <select id="run-file-split" aria-describedby="run-file-split-hint" value={fileSplit} onChange={(e) => {
              const v = e.target.value as Split;
              setFileSplit(v);
              setF((x) => ({ ...x, rows: x.rows.map((r, i) => (unsplit.includes(i) ? { ...r, split: v } : r)) }));
            }}>
              {SPLITS.map((s) => <option key={s} value={s}>{m.splits[s]}</option>)}
            </select>
          </div>
        ) : null}
      </fieldset>

      {field('log', true)}
      {field('notes', true)}
      {hidden.length ? <p className="notice" role="alert">{hidden.includes('secret') ? m.hiddenSecret : m.hiddenOther}</p> : null}
      {maybePii(`${f.log}\n${f.notes}\n${f.settings}\n${f.hardware}`) ? <p className="hint" role="status">{m.maybePersonal}</p> : null}
      {problems.length ? <ul className="notice" role="alert">{problems.map((p) => <li key={p}>{p}</li>)}</ul> : null}
      <div className="lab-actions">
        <button type="button" className="btn" onClick={save}>{m.saveRun}</button>
        <button type="button" className="btn ghost" onClick={onCancel}>{m.cancel}</button>
      </div>
    </div>
  );
}

function Feedback({ fb, m }: { fb: RunFeedback; m: Messages }) {
  const block = (title: string, items: string[]) => (items.length ? <><p><b>{title}</b></p><ul className="todo">{items.map((x) => <li key={x}>{x}</li>)}</ul></> : null);
  return (
    <div className="lab-result" role="status">
      <p>{fb.summary}</p>
      {block(m.canSupport, fb.can_support)}
      {block(m.cannotSupport, fb.cannot_support)}
      {block(m.missing, fb.missing)}
      {fb.next_action ? <p><b>{m.next}</b> {fb.next_action}</p> : null}
      <p className="hint">{m.basedOn}{fb.removed ? ` ${m.removedClaims(fb.removed)}` : ''}</p>
      {fb.kinds?.includes('unknown_split') ? <p className="hint">{m.removedUnknownSplit}</p> : null}
      {fb.kinds?.includes('unknown_scale') ? <p className="hint">{m.removedUnknownScale}</p> : null}
      {fb.kinds?.includes('target') ? <p className="hint">{m.removedTarget}</p> : null}
    </div>
  );
}

function RunCard({ run, onEdit, onDelete, onSheet, topic, onAi, lang, signedOut }: { run: RunRecord; onEdit: () => void; onDelete: () => void; onSheet: () => void; topic: string; onAi: () => void; lang: Lang; signedOut: boolean }) {
  const m = messages(lang);
  const [confirm, setConfirm] = useState(false);
  const [fb, setFb] = useState<RunFeedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function ask() {
    setBusy(true);
    setError('');
    try {
      setFb(await request<RunFeedback>('/api/runs/feedback', { method: 'POST', headers: { 'content-type': 'application/json', ...(await authHeaders()) }, body: JSON.stringify({ run, topic, language: lang, llm: loadAi() ?? undefined }) }));
      onAi();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const facts: [string, string][] = (
    [
      ['step', stepTitle(run.stepId, lang) || m.unassigned],
      ['purpose', run.purpose], ['dataset', run.dataset], ['split', run.split], ['model', run.model], ['seeds', run.seeds],
      ['versions', run.versions], ['hardware', run.hardware], ['duration', run.duration], ['settings', run.settings], ['notes', run.notes],
    ] as [string, string][]
  ).filter(([, v]) => v).map(([k, v]) => [m.facts[k], v]);

  return (
    <li className="sheet lab-card" data-testid="run-card" aria-busy={busy}>
      <div className="lab-head">
        <h3>{run.name}</h3>
        <span className="tag">{run.createdAt.slice(0, 10)}</span>
      </div>
      <p className="lab-badge">{m.reportedByYou}{run.outcome === 'failed' ? ` · ${m.failedRun}` : ''}</p>
      <dl className="run-facts">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      {run.metrics.length ? (
        <div className="table-wrap">
          <table className="run-table">
            <thead><tr><th scope="col">{m.colResult}</th><th scope="col">{m.colSplit}</th><th scope="col">{m.colValue}</th></tr></thead>
            <tbody>{run.metrics.map((x) => <tr key={`${x.name}|${x.split}`}><td>{x.name}</td><td>{m.splits[x.split]}</td><td>{num(x.value, lang, 12)}</td></tr>)}</tbody>
          </table>
        </div>
      ) : null}
      {run.log ? <details><summary>{m.logExcerpt}</summary><pre className="run-log">{run.log}</pre></details> : null}
      <div className="lab-actions">
        <button type="button" className="btn ghost" onClick={onSheet}>{run.addedToSheet ? m.addToSheetAgain : m.addToSheet}</button>
        {signedOut ? (
          <Link className="btn ghost linkbtn" href="/account" title={m.signInForFeedback}>{m.signInForFeedback}</Link>
        ) : (
          <button type="button" className="btn ghost" onClick={ask} disabled={busy} aria-describedby={busy ? `busy-${run.id}` : undefined}>{busy ? m.readingRun : m.askFeedback}</button>
        )}
        <button type="button" className="btn ghost" onClick={onEdit}>{m.edit}</button>
        {!confirm ? <button type="button" className="btn ghost" onClick={() => setConfirm(true)}>{m.delete}</button> : null}
      </div>
      {confirm ? (
        <div className="notice confirm" role="alert">
          <p>{m.deleteQuestion}</p>
          <div className="lab-actions">
            <button type="button" className="btn danger" onClick={onDelete}>{m.deleteConfirm}</button>
            <button type="button" className="btn ghost" onClick={() => setConfirm(false)}>{m.keepIt}</button>
          </div>
        </div>
      ) : null}
      {run.addedToSheet ? <p className="hint">{m.addedOn(run.addedToSheet.slice(0, 10), stepTitle('evidence', lang))}</p> : null}
      {busy ? <p className="hint" id={`busy-${run.id}`} role="status">{m.readingRun}</p> : null}
      {error ? <p className="notice" role="alert">{error}{/sign in/i.test(error) ? <> <Link href="/account">{m.signInLink}</Link></> : null}</p> : null}
      {fb ? <Feedback fb={fb} m={m} /> : null}
    </li>
  );
}

export function Runs({ path, os, editPath, lang = 'en', signedOut = false }: { path: PathState; os: Os | null; editPath: (fn: (p: PathState) => PathState) => void; lang?: Lang; signedOut?: boolean }) {
  const m = messages(lang);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  // The run as it was when editing started, so the edit survives if another window deletes it meanwhile.
  const [snapshot, setSnapshot] = useState<RunRecord | null>(null);
  const [filter, setFilter] = useState<StepFilter>('all');
  const [notice, setNotice] = useState('');
  const runs = cleanRuns(path.runs);
  const summary = summarize(runs).filter((s) => s.n > 1);
  const setRuns = (fn: (r: RunRecord[]) => RunRecord[]) => editPath((p) => ({ ...p, runs: fn(cleanRuns(p.runs)) }));

  // The Document page links here with ?step=<id> to show the runs of one step.
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get('step');
    if (s === 'none' || isStepId(s)) setFilter(s);
  }, []);

  if (!path.started) {
    return (
      <section className="runs" id="runs" aria-labelledby="runs-title">
        <h2 id="runs-title" style={{ marginTop: 32 }}>{m.runsTitle}</h2>
        <p className="hint">{m.runsNeedThesis}</p>
        <p style={{ marginTop: 8 }}><Link className="btn linkbtn" href="/">{m.startThesis}</Link></p>
      </section>
    );
  }

  const editingRun = editing && editing !== 'new' ? runs.find((r) => r.id === editing) ?? (snapshot?.id === editing ? snapshot : undefined) : undefined;
  const initial: RunDraft = editingRun ? (({ id: _i, source: _s, createdAt: _c, updatedAt: _u, addedToSheet: _a, ...d }) => d)(editingRun) : { ...emptyDraft(), versions: versionsFromLab(cleanLab(path.lab), os), ...(isStepId(filter) ? { stepId: filter } : {}) };
  const counts: Record<string, number> = { all: runs.length, none: runs.filter((r) => !r.stepId).length };
  for (const r of runs) if (r.stepId) counts[r.stepId] = (counts[r.stepId] ?? 0) + 1;
  const shown = runs.filter((r) => filter === 'all' || (filter === 'none' ? !r.stepId : r.stepId === filter));

  return (
    <section className="runs" id="runs" aria-labelledby="runs-title">
      <h2 id="runs-title" style={{ marginTop: 32 }}>{m.runsTitle}</h2>
      <p className="hint">{m.runsIntro}</p>

      {summary.length ? (
        <div className="sheet" style={{ marginTop: 12 }}>
          <h3>{m.repeated}</h3>
          <p className="hint">{m.repeatedHint}</p>
          <p className="hint swipe-hint">{m.swipeTable}</p>
          <div className="table-wrap" tabIndex={0} role="region" aria-label={m.repeated}>
            <table className="run-table" data-testid="run-summary">
              <thead><tr><th scope="col">{m.colResult}</th><th scope="col">{m.colSplit}</th><th scope="col">{m.colRuns}</th><th scope="col">{m.colMean}</th><th scope="col">{m.colSd}</th><th scope="col">{m.colRange}</th></tr></thead>
              <tbody>{summary.map((s) => <tr key={`${s.name}|${s.split}`}><td>{s.name}</td><td>{m.splits[s.split]}</td><td>{s.n}</td><td>{num(s.mean, lang)}</td><td>{s.sd === null ? '—' : num(s.sd, lang)}</td><td>{m.range(num(s.min, lang, 12), num(s.max, lang, 12))}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      ) : null}

      {editing ? (
        <RunForm
          // The key is the run only: changing language keeps what the student has typed.
          key={editing}
          initial={initial}
          lang={lang}
          onCancel={() => setEditing(null)}
          onSave={(d) => {
            const now = new Date().toISOString();
            setRuns((rs) => {
              if (!editingRun) return [...rs, newRun(d, now)];
              // The run was deleted in another tab while it was being edited: the edit is kept, not dropped.
              if (!rs.some((r) => r.id === editingRun.id)) {
                setNotice(m.restoredRun);
                const { stepId: _old, ...base } = editingRun;
                return [...rs, { ...base, ...d, updatedAt: now }];
              }
              return rs.map((r) => {
                if (r.id !== editingRun.id) return r;
                // The ID, the creation date and the results sheet date stay. A cleared step is removed.
                const { stepId: _old, ...base } = r;
                return { ...base, ...d, updatedAt: now };
              });
            });
            setEditing(null);
          }}
        />
      ) : (
        <p style={{ marginTop: 12 }}>
          <button type="button" className="btn" onClick={() => setEditing('new')} disabled={runs.length >= 40}>{m.addRun}</button>
          {runs.length >= 40 ? <span className="hint"> {m.runLimit}</span> : null}
        </p>
      )}

      {notice ? <p className="notice" role="status" style={{ marginTop: 12 }}>{notice}</p> : null}
      {runs.length ? (
        <>
          <div className="field run-filter">
            <label htmlFor="run-filter"><b>{m.filterLabel}</b></label>
            <StepSelect id="run-filter" value={filter} onChange={setFilter} lang={lang} includeAll counts={counts} />
          </div>
          {shown.length ? (
            <ol className="lab-list">
              {[...shown].reverse().map((r) => (
                <RunCard
                  key={r.id}
                  run={r}
                  lang={lang}
                  signedOut={signedOut}
                  topic={path.title || path.topic}
                  onEdit={() => {
                    setSnapshot(r);
                    setEditing(r.id);
                  }}
                  onDelete={() => setRuns((rs) => rs.filter((x) => x.id !== r.id))}
                  onSheet={() =>
                    editPath((p) => {
                      const now = new Date().toISOString();
                      const st = stepState(p, 'evidence');
                      const work = appendToResultsSheet(st.work, runToText(r, lang), STEPS.find((x) => x.id === 'evidence')?.workTemplate ?? '');
                      return { ...p, steps: { ...p.steps, evidence: { ...st, work } }, runs: cleanRuns(p.runs).map((x) => (x.id === r.id ? { ...x, addedToSheet: now } : x)) };
                    })
                  }
                  onAi={() => editPath((p) => ({ ...p, log: [...p.log, { at: new Date().toISOString(), step: r.stepId ?? r.step, tool: `Run feedback: comments on the reported run "${r.name}"` }] }))}
                />
              ))}
            </ol>
          ) : (
            <p className="empty" style={{ marginTop: 12 }}>{m.noRunsForStep}</p>
          )}
        </>
      ) : (
        <p className="empty" style={{ marginTop: 12 }}>{m.noRuns}</p>
      )}
    </section>
  );
}
