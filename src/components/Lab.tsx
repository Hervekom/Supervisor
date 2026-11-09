'use client';
import { useEffect, useState } from 'react';
import { guessOs, OS_LABELS, selectTools, WORK_TYPES, type GpuAnswer, type Os, type Selection, type Software, type WorkType } from '@/lib/software';

const KEY = 'lab:v1';
type Saved = Selection & { marked: Record<string, boolean>; osConfirmed: boolean };
const EMPTY: Saved = { workTypes: [], os: null, gpu: 'not_sure', marked: {}, osConfirmed: false };
const GPU_TYPES: (WorkType | 'python')[] = ['deep_learning', 'computer_vision', 'nlp'];

function load(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return v && Array.isArray(v.workTypes) ? { ...EMPTY, ...v } : EMPTY;
  } catch {
    return EMPTY;
  }
}

function CopyCommand({ command }: { command: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setState('copied');
    } catch {
      setState('failed');
    }
    setTimeout(() => setState('idle'), 2500);
  }
  return (
    <div className="cmd">
      <code>{command}</code>
      <button type="button" className="btn ghost" onClick={copy} aria-label={`Copy command: ${command}`}>{state === 'copied' ? 'Copied' : 'Copy'}</button>
      {state === 'failed' ? <span className="hint" role="status">Select the text and copy it yourself.</span> : null}
    </div>
  );
}

export function Lab({ catalogue }: { catalogue: Software[] }) {
  const [s, setS] = useState<Saved>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [suggested, setSuggested] = useState<Os | null>(null);
  const [wide, setWide] = useState(false);

  useEffect(() => {
    const saved = load();
    const guess = guessOs(navigator.userAgent);
    setSuggested(guess);
    setS(saved.os ? saved : { ...saved, os: guess });
    setWide(window.matchMedia('(min-width: 721px)').matches);
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {}
  }, [s, loaded]);

  const update = (p: Partial<Saved>) => setS((x) => ({ ...x, ...p }));
  const toggleType = (id: WorkType | 'python') => update({ workTypes: s.workTypes.includes(id) ? s.workTypes.filter((x) => x !== id) : [...s.workTypes, id] });
  const tools = selectTools(catalogue, s);
  const marked = tools.filter((t) => s.marked[t.id]).length;
  const askGpu = s.os !== 'macos' && s.workTypes.some((w) => GPU_TYPES.includes(w));

  return (
    <>
      <h1>Lab</h1>
      <p className="lede">Set up your computer for the experiments in your research. Tell us what your project involves, and you get only the tools you need, with official links and checks.</p>
      <p className="hint" style={{ marginTop: 6 }}>If your research has no code or data analysis, you do not need this page.</p>
      <p className="notice pc-note" role="note">Installing happens on a computer, not on a phone. Read the steps here, then continue on your PC.</p>

      <div className="sheet" style={{ marginTop: 20 }}>
        <fieldset className="field">
          <legend><b>1. What does your research involve?</b></legend>
          <p className="hint">Choose all that apply.</p>
          <div className="choices">
            {WORK_TYPES.map((w) => (
              <label key={w.id} className="choice">
                <input type="checkbox" checked={s.workTypes.includes(w.id)} onChange={() => toggleType(w.id)} />
                <span><b>{w.label}</b><span className="hint">{w.hint}</span></span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="field" style={{ marginTop: 18 }}>
          <legend><b>2. Which system is your research computer?</b></legend>
          <div className="choices row">
            {(Object.keys(OS_LABELS) as Os[]).map((os) => (
              <label key={os} className="choice">
                <input type="radio" name="os" checked={s.os === os} onChange={() => update({ os, osConfirmed: true })} />
                <span>{OS_LABELS[os]}</span>
              </label>
            ))}
          </div>
          {s.os && !s.osConfirmed && s.os === suggested ? <p className="hint" role="status">Suggested from your browser. Change it if your research computer is different.</p> : null}
          {!s.os ? <p className="hint">Choose the system of the computer where you will run experiments.</p> : null}
        </fieldset>

        {askGpu ? (
          <fieldset className="field" style={{ marginTop: 18 }}>
            <legend><b>3. Does that computer have an NVIDIA graphics card?</b></legend>
            <div className="choices row">
              {([['yes', 'Yes'], ['no', 'No'], ['not_sure', 'Not sure']] as [GpuAnswer, string][]).map(([v, l]) => (
                <label key={v} className="choice">
                  <input type="radio" name="gpu" checked={s.gpu === v} onChange={() => update({ gpu: v })} />
                  <span>{l}</span>
                </label>
              ))}
            </div>
            {s.gpu === 'not_sure' ? <p className="hint">The NVIDIA card below shows how to check. Without one, you can still learn and test on the CPU.</p> : null}
          </fieldset>
        ) : null}
      </div>

      {tools.length ? (
        <>
          <h2 style={{ marginTop: 28 }}>Your setup checklist</h2>
          <p className="hint" role="status">{tools.length} tools. {marked} marked installed by you. None technically verified yet.</p>
          <p className="hint">Follow them in order. Supervisor never runs these commands for you: you run them on your computer.</p>
          <ol className="lab-list">
            {tools.map((t) => {
              const os = s.os!;
              const done = !!s.marked[t.id];
              const steps = t.install[os] ?? [];
              const check = t.verify[os];
              return (
                <li key={t.id} className="sheet lab-card">
                  <div className="lab-head">
                    <h3>{t.name}</h3>
                    <span className="tag">{t.level === 'recommended' ? 'Recommended' : t.level === 'conditional' ? 'Only if it applies' : 'Needed'}</span>
                  </div>
                  <p>{t.purpose}</p>
                  <p className="hint"><b>Version:</b> {t.version_guidance}</p>
                  <p className="lab-links">
                    <a href={t.official_download_url} target="_blank" rel="noopener noreferrer">Official download page ↗</a>
                    <a href={t.official_docs_url} target="_blank" rel="noopener noreferrer">Official documentation ↗</a>
                  </p>
                  <details open={wide}>
                    <summary>Steps and check for {OS_LABELS[os]}</summary>
                    <ol className="todo">
                      {steps.map((st, i) => (
                        <li key={i}>
                          {st.text}
                          {st.command ? <CopyCommand command={st.command} /> : null}
                        </li>
                      ))}
                    </ol>
                    {check ? (
                      <div style={{ marginTop: 10 }}>
                        <p><b>Check it worked:</b> run this in a terminal.</p>
                        <CopyCommand command={check.command} />
                        <p className="hint"><b>You should see:</b> {check.expected}</p>
                      </div>
                    ) : null}
                  </details>
                  <details>
                    <summary>Common problems</summary>
                    <ul className="todo">{t.common_problems.map((p) => <li key={p.problem}><b>{p.problem}.</b> {p.solution}</li>)}</ul>
                  </details>
                  <div className="lab-status">
                    <label className="choice">
                      <input type="checkbox" checked={done} onChange={() => update({ marked: { ...s.marked, [t.id]: !done } })} />
                      <span>I followed the installation steps</span>
                    </label>
                    <p className="hint" role="status">{done ? 'Marked installed by you. Not yet technically verified.' : 'Not started. Not yet technically verified.'}</p>
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="hint" style={{ marginTop: 12 }}>Your choices and ticks are saved in this browser only. Links were last reviewed on {tools[0].last_reviewed}. If a page looks different, follow the official page.</p>
        </>
      ) : loaded ? (
        <p className="empty" style={{ marginTop: 24 }}>{!s.workTypes.length ? 'Choose what your research involves to see your checklist.' : 'Choose your system to see your checklist.'}</p>
      ) : null}
    </>
  );
}
