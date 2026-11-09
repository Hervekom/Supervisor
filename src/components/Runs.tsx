'use client';
import Link from 'next/link';
import { useState } from 'react';
import { loadAi } from '@/lib/aiSettings';
import { cleanLab } from '@/lib/lab';
import { findSensitive } from '@/lib/labVerify';
import { stepState, type PathState } from '@/lib/path';
import { errorText, request } from '@/lib/request';
import type { RunFeedback } from '@/lib/runFeedback';
import { cleanDraft, cleanRuns, emptyDraft, fmt, newRun, parseMetricsFile, parseNumber, runProblems, runToText, SPLITS, summarize, versionsFromLab, type Metric, type RunDraft, type RunRecord, type Split } from '@/lib/runs';
import type { Os } from '@/lib/software';
import { authHeaders } from '@/lib/supabase';

type Row = { name: string; value: string; split: Split };
type Form = Omit<RunDraft, 'metrics'> & { rows: Row[] };

const toForm = (d: RunDraft): Form => ({ ...d, rows: d.metrics.map((m) => ({ name: m.name, value: String(m.value), split: m.split })) });
const SPLIT_LABEL: Record<Split, string> = { test: 'Test', validation: 'Validation', train: 'Training', other: 'Other' };

function toDraft(f: Form): { draft: RunDraft; problems: string[] } {
  const problems: string[] = [];
  const metrics: Metric[] = [];
  for (const r of f.rows) {
    if (!r.name.trim() && !r.value.trim()) continue;
    const v = parseNumber(r.value);
    if (!r.name.trim()) problems.push('Each result needs a name, for example "accuracy".');
    else if (v === null) problems.push(`"${r.name}" needs a number, for example 0.91 or 91%.`);
    else metrics.push({ name: r.name, value: v, split: r.split });
  }
  const { rows: _rows, ...rest } = f;
  const draft = cleanDraft({ ...rest, metrics });
  return { draft, problems: [...problems, ...runProblems(draft)] };
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

function RunForm({ initial, onSave, onCancel }: { initial: RunDraft; onSave: (d: RunDraft) => void; onCancel: () => void }) {
  const [f, setF] = useState<Form>(() => toForm(initial));
  const [problems, setProblems] = useState<string[]>([]);
  const [fileNote, setFileNote] = useState('');
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const setRow = (i: number, r: Partial<Row>) => setF((x) => ({ ...x, rows: x.rows.map((row, k) => (k === i ? { ...row, ...r } : row)) }));
  const hidden = findSensitive(`${f.log}\n${f.notes}\n${f.settings}\n${f.hardware}`);

  async function importFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 50_000) return setFileNote('This file is larger than 50 KB. Keep only the final metrics in it.');
    const { metrics, problems: p } = parseMetricsFile(file.name, await file.text());
    if (metrics.length) setF((x) => ({ ...x, rows: [...x.rows.filter((r) => r.name.trim() || r.value.trim()), ...metrics.map((m) => ({ name: m.name, value: String(m.value), split: m.split }))] }));
    setFileNote([metrics.length ? `${metrics.length} results read from ${file.name}. Check them below.` : '', ...p].filter(Boolean).join(' '));
  }

  function save() {
    const { draft, problems: p } = toDraft(f);
    setProblems(p);
    if (!p.length) onSave(draft);
  }

  return (
    <div className="sheet run-form">
      <div className="choices row" role="radiogroup" aria-label="How did the run end?">
        {(['completed', 'failed'] as const).map((o) => (
          <label key={o} className="choice">
            <input type="radio" name="outcome" checked={f.outcome === o} onChange={() => set('outcome', o)} />
            <span>{o === 'completed' ? 'It finished and gave results' : 'It failed or stopped'}</span>
          </label>
        ))}
      </div>
      <Field id="run-name" label="Run name" hint='For example "Baseline, seed 1" or "Full model without attention".' value={f.name} onChange={(v) => set('name', v)} />
      <Field id="run-purpose" label="Why you ran it" value={f.purpose} onChange={(v) => set('purpose', v)} />
      <div className="run-grid">
        <Field id="run-dataset" label="Data" hint="Name and size only. Your data stays on your computer." value={f.dataset} onChange={(v) => set('dataset', v)} />
        <Field id="run-split" label="Split" hint="For example 70 / 15 / 15, or 5-fold." value={f.split} onChange={(v) => set('split', v)} />
        <Field id="run-model" label="Method or model" value={f.model} onChange={(v) => set('model', v)} />
        <Field id="run-seeds" label="Random seeds" value={f.seeds} onChange={(v) => set('seeds', v)} />
        <Field id="run-hardware" label="Hardware" hint="For example CPU only, or the GPU name." value={f.hardware} onChange={(v) => set('hardware', v)} />
        <Field id="run-duration" label="How long it took" value={f.duration} onChange={(v) => set('duration', v)} />
      </div>
      <Field id="run-versions" label="Software versions" hint="Filled from the checks you verified above. Edit if your run used something else." value={f.versions} onChange={(v) => set('versions', v)} />
      <Field id="run-settings" label="Main settings" hint="For example learning rate, batch size, epochs." value={f.settings} onChange={(v) => set('settings', v)} area />

      <fieldset className="field">
        <legend><b>Results</b></legend>
        <p className="hint">Type each number your run printed. Supervisor never fills in a result for you.</p>
        <div className="metric-rows">
          {f.rows.map((r, i) => (
            <div key={i} className="metric-row">
              <input type="text" aria-label={`Result ${i + 1} name`} placeholder="accuracy" value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} />
              <input type="text" inputMode="decimal" aria-label={`Result ${i + 1} value`} placeholder="0.91" value={r.value} onChange={(e) => setRow(i, { value: e.target.value })} />
              <select aria-label={`Result ${i + 1} data split`} value={r.split} onChange={(e) => setRow(i, { split: e.target.value as Split })}>
                {SPLITS.map((s) => <option key={s} value={s}>{SPLIT_LABEL[s]}</option>)}
              </select>
              <button type="button" className="btn ghost" aria-label={`Remove result ${i + 1}`} onClick={() => setF((x) => ({ ...x, rows: x.rows.filter((_, k) => k !== i) }))}>Remove</button>
            </div>
          ))}
        </div>
        <div className="lab-actions">
          <button type="button" className="btn ghost" onClick={() => setF((x) => ({ ...x, rows: [...x.rows, { name: '', value: '', split: 'test' }] }))}>Add a result</button>
          <label className="btn ghost file-btn">
            Read results from a file
            <input type="file" accept=".csv,.json,text/csv,application/json" onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        </div>
        <p className="hint">A small .csv or .json file with your final metrics. It is read in your browser and not uploaded.</p>
        {fileNote ? <p className="hint" role="status">{fileNote}</p> : null}
      </fieldset>

      <Field id="run-log" label="Log excerpt (optional)" hint="Paste only the last useful lines, up to 2,000 characters." value={f.log} onChange={(v) => set('log', v.slice(0, 2000))} area />
      <Field id="run-notes" label="Notes" hint="What changed from the plan, what failed or surprised you." value={f.notes} onChange={(v) => set('notes', v)} area />
      {hidden.length ? (
        <p className="notice" role="alert">
          {hidden.includes('secret') ? 'A password, key or token will be replaced with [secret] when you save.' : 'User names in file paths, emails and addresses will be replaced with [user], [email] or [ip] when you save.'}
        </p>
      ) : null}
      {problems.length ? (
        <ul className="notice" role="alert">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
      ) : null}
      <div className="lab-actions">
        <button type="button" className="btn" onClick={save}>Save run</button>
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function Feedback({ fb }: { fb: RunFeedback }) {
  const block = (title: string, items: string[]) => (items.length ? <><p><b>{title}</b></p><ul className="todo">{items.map((x) => <li key={x}>{x}</li>)}</ul></> : null);
  return (
    <div className="lab-result" role="status">
      <p>{fb.summary}</p>
      {block('What this run can support', fb.can_support)}
      {block('What it cannot support yet', fb.cannot_support)}
      {block('Missing', fb.missing)}
      {fb.next_action ? <p><b>Next:</b> {fb.next_action}</p> : null}
      <p className="hint">AI comments based only on what you reported. Added to your AI use record.{fb.removed ? ` ${fb.removed} sentence${fb.removed > 1 ? 's were' : ' was'} removed because ${fb.removed > 1 ? 'they' : 'it'} stated numbers you did not report.` : ''}</p>
    </div>
  );
}

function RunCard({ run, onEdit, onDelete, onSheet, topic, onAi }: { run: RunRecord; onEdit: () => void; onDelete: () => void; onSheet: () => void; topic: string; onAi: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [fb, setFb] = useState<RunFeedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function ask() {
    setBusy(true);
    setError('');
    try {
      setFb(await request<RunFeedback>('/api/runs/feedback', { method: 'POST', headers: { 'content-type': 'application/json', ...(await authHeaders()) }, body: JSON.stringify({ run, topic, language: 'English', llm: loadAi() ?? undefined }) }));
      onAi();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const facts: [string, string][] = [
    ['Why', run.purpose], ['Data', run.dataset], ['Split', run.split], ['Method or model', run.model], ['Seeds', run.seeds],
    ['Software', run.versions], ['Hardware', run.hardware], ['Time', run.duration], ['Settings', run.settings], ['Notes', run.notes],
  ].filter(([, v]) => v) as [string, string][];

  return (
    <li className="sheet lab-card" data-testid="run-card">
      <div className="lab-head">
        <h3>{run.name}</h3>
        <span className="tag">{run.createdAt.slice(0, 10)}</span>
      </div>
      <p className="lab-badge">Reported by you{run.outcome === 'failed' ? ' · Failed run' : ''}</p>
      {facts.length ? <dl className="run-facts">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl> : null}
      {run.metrics.length ? (
        <table className="run-table">
          <thead><tr><th scope="col">Result</th><th scope="col">Split</th><th scope="col">Value</th></tr></thead>
          <tbody>{run.metrics.map((m) => <tr key={`${m.name}|${m.split}`}><td>{m.name}</td><td>{SPLIT_LABEL[m.split]}</td><td>{fmt(m.value, 12)}</td></tr>)}</tbody>
        </table>
      ) : null}
      {run.log ? <details><summary>Log excerpt</summary><pre className="run-log">{run.log}</pre></details> : null}
      <div className="lab-actions">
        <button type="button" className="btn ghost" onClick={onSheet}>{run.addedToSheet ? 'Add to my results sheet again' : 'Add to my results sheet'}</button>
        <button type="button" className="btn ghost" onClick={ask} disabled={busy}>{busy ? 'Reading your run…' : 'Ask for feedback'}</button>
        <button type="button" className="btn ghost" onClick={onEdit}>Edit</button>
        {confirm ? (
          <>
            <button type="button" className="btn" onClick={onDelete}>Delete this run</button>
            <button type="button" className="btn ghost" onClick={() => setConfirm(false)}>Keep it</button>
          </>
        ) : (
          <button type="button" className="btn ghost" onClick={() => setConfirm(true)}>Delete</button>
        )}
      </div>
      {run.addedToSheet ? <p className="hint">Added to your results sheet on {run.addedToSheet.slice(0, 10)}, in the step “Bring your results for writing”.</p> : null}
      {error ? <p className="notice" role="alert">{error}</p> : null}
      {fb ? <Feedback fb={fb} /> : null}
    </li>
  );
}

export function Runs({ path, os, editPath }: { path: PathState; os: Os | null; editPath: (fn: (p: PathState) => PathState) => void }) {
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const runs = cleanRuns(path.runs);
  const summary = summarize(runs).filter((s) => s.n > 1);
  const setRuns = (fn: (r: RunRecord[]) => RunRecord[]) => editPath((p) => ({ ...p, runs: fn(cleanRuns(p.runs)) }));

  if (!path.started) {
    return (
      <section className="runs" aria-labelledby="runs-title">
        <h2 id="runs-title" style={{ marginTop: 32 }}>Experiment runs</h2>
        <p className="hint">Once your thesis is started, you can record each run here so it is saved with your thesis.</p>
        <p style={{ marginTop: 8 }}><Link className="btn linkbtn" href="/">Start my thesis</Link></p>
      </section>
    );
  }

  const editingRun = runs.find((r) => r.id === editing);
  const initial = editingRun ? (({ id: _i, source: _s, createdAt: _c, updatedAt: _u, addedToSheet: _a, ...d }) => d)(editingRun) : { ...emptyDraft(), versions: versionsFromLab(cleanLab(path.lab), os) };

  return (
    <section className="runs" aria-labelledby="runs-title">
      <h2 id="runs-title" style={{ marginTop: 32 }}>Experiment runs</h2>
      <p className="hint">Record each run you did on your computer: its settings and the results it printed. Supervisor never runs your code and never fills in a number. Record failed runs too. They show what you tried.</p>

      {summary.length ? (
        <div className="sheet" style={{ marginTop: 12 }}>
          <h3>Repeated results</h3>
          <p className="hint">Mean and standard deviation across your completed runs, calculated only from the numbers you reported.</p>
          <table className="run-table" data-testid="run-summary">
            <thead><tr><th scope="col">Result</th><th scope="col">Split</th><th scope="col">Runs</th><th scope="col">Mean</th><th scope="col">Standard deviation</th><th scope="col">Range</th></tr></thead>
            <tbody>{summary.map((s) => <tr key={`${s.name}|${s.split}`}><td>{s.name}</td><td>{SPLIT_LABEL[s.split]}</td><td>{s.n}</td><td>{fmt(s.mean)}</td><td>{s.sd === null ? '—' : fmt(s.sd)}</td><td>{fmt(s.min, 12)} to {fmt(s.max, 12)}</td></tr>)}</tbody>
          </table>
        </div>
      ) : null}

      {editing ? (
        <RunForm
          key={editing}
          initial={initial}
          onCancel={() => setEditing(null)}
          onSave={(d) => {
            const now = new Date().toISOString();
            setRuns((rs) => (editingRun ? rs.map((r) => (r.id === editingRun.id ? { ...r, ...d, updatedAt: now } : r)) : [...rs, newRun(d, now)]));
            setEditing(null);
          }}
        />
      ) : (
        <p style={{ marginTop: 12 }}><button type="button" className="btn" onClick={() => setEditing('new')} disabled={runs.length >= 40}>Add a run</button>{runs.length >= 40 ? <span className="hint"> You have reached 40 runs. Delete old ones to add more.</span> : null}</p>
      )}

      {runs.length ? (
        <ol className="lab-list">
          {[...runs].reverse().map((r) => (
            <RunCard
              key={r.id}
              run={r}
              topic={path.title || path.topic}
              onEdit={() => setEditing(r.id)}
              onDelete={() => setRuns((rs) => rs.filter((x) => x.id !== r.id))}
              onSheet={() =>
                editPath((p) => {
                  const now = new Date().toISOString();
                  const st = stepState(p, 'evidence');
                  const work = `${st.work.trim() ? `${st.work.trimEnd()}\n\n` : ''}${runToText(r)}`;
                  return { ...p, steps: { ...p.steps, evidence: { ...st, work } }, runs: cleanRuns(p.runs).map((x) => (x.id === r.id ? { ...x, addedToSheet: now } : x)) };
                })
              }
              onAi={() => editPath((p) => ({ ...p, log: [...p.log, { at: new Date().toISOString(), step: r.step, tool: `Run feedback: comments on the reported run "${r.name}"` }] }))}
            />
          ))}
        </ol>
      ) : (
        <p className="empty" style={{ marginTop: 12 }}>No runs recorded yet.</p>
      )}
    </section>
  );
}
