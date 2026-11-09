'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useAccount } from '@/components/useAccount';
import { put } from '@/components/useProfiles';
import { usePathSync } from '@/components/usePathSync';
import { cleanLab, currentCheck, emptyLab, fromLabV1, hasLabProgress, newerLab, recordCheck, setMarked, STATUS_LABEL, statusOf, update, type LabState, type LabStatus } from '@/lib/lab';
import { explain, findSensitive, VERIFY_COMMANDS, verifyOutput, type CheckResult, type Sensitive } from '@/lib/labVerify';
import { emptyPath, isPathState, type PathState } from '@/lib/path';
import { hasWork, LAB_MIRROR_KEY, LAB_V1_KEY, PATH_KEY, readLocalPath } from '@/lib/pathSync';
import { guessOs, OS_LABELS, selectTools, WORK_TYPES, type GpuAnswer, type Os, type Software, type WorkType } from '@/lib/software';

const GPU_TYPES: (WorkType | 'python')[] = ['deep_learning', 'computer_vision', 'nlp'];
const PYTHON_ENV = new Set(['venv', 'jupyterlab', 'numpy', 'pandas', 'matplotlib', 'scikit-learn', 'pytorch']);
const WHERE: Record<Os, string> = { windows: 'Command Prompt or PowerShell', macos: 'Terminal', linux: 'a terminal' };
const VERIFY_LINE: Record<LabStatus, string> = { not_started: 'Not checked yet.', marked: 'Not checked yet.', pending: 'Pending.', verified: 'Verified.', failed: 'Failed.', manual_review: 'Manual review required.' };
const SENSITIVE_TEXT: Record<Sensitive, string> = {
  user_path: 'a file path that may show your user name',
  email: 'an email address',
  ip: 'what looks like an IP address',
  secret: 'what looks like a password, key or token',
};

function readJson(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}
/** A browser copy of the Lab, so progress survives when the account's copy replaces this browser's. */
const readMirror = () => cleanLab(readJson(LAB_MIRROR_KEY)) ?? fromLabV1(readJson(LAB_V1_KEY));

/** Puts the newer Lab progress into the path. Leaves the path untouched when nothing changes. */
function withLab(p: PathState, mirror: LabState | undefined): PathState {
  const own = cleanLab(p.lab);
  const best = newerLab(own, mirror);
  if (!best || best === own || !hasLabProgress(best)) return p;
  return { ...p, lab: best, savedAt: new Date().toISOString() };
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

function Verify({ tool, os, gpu, lab, draft, setDraft, onResult }: { tool: Software; os: Os; gpu: GpuAnswer; lab: LabState; draft: string; setDraft: (v: string) => void; onResult: (r: CheckResult) => void }) {
  const [last, setLast] = useState<CheckResult | null>(null);
  const command = VERIFY_COMMANDS[tool.id]?.[os] ?? tool.verify[os]?.command ?? '';
  const expected = tool.verify[os]?.expected ?? '';
  const sensitive = findSensitive(draft);
  const saved = currentCheck(lab.tools[tool.id], os);
  const stale = !saved ? lab.tools[tool.id]?.check : undefined;
  const status: LabStatus = statusOf(lab.tools[tool.id], os, draft);
  // Empty or blocked input is never saved, so its message comes from this visit only.
  const notice = last && (last.status === 'empty' || last.status === 'blocked') ? explain(last.reason, command) : null;
  const why = saved && saved.status !== 'verified' && status !== 'pending' ? explain(saved.reason, command) : null;
  const fieldId = `out-${tool.id}`;

  function check() {
    const r = verifyOutput(tool.id, draft, { os, gpu });
    setLast(r);
    onResult(r);
    // The pasted text is not kept once it has been checked.
    if (r.status !== 'empty' && r.status !== 'blocked') setDraft('');
  }

  return (
    <div className="lab-verify">
      <p><b>Check it worked.</b> On your research computer, open {WHERE[os]}{PYTHON_ENV.has(tool.id) ? ' in your project folder, with .venv active,' : ''} and run:</p>
      <CopyCommand command={command} />
      <p className="hint"><b>You should see:</b> {expected}</p>
      <label htmlFor={fieldId}><b>Paste what the command printed</b></label>
      <p className="hint" id={`${fieldId}-hint`}>Remove names, emails, passwords and keys first. The check runs in your browser. Only the result and the version are kept, never the text you paste.</p>
      <textarea id={fieldId} aria-describedby={`${fieldId}-hint`} value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} spellCheck={false} autoCapitalize="off" autoCorrect="off" placeholder={`Output of ${command}`} />
      {sensitive.length ? (
        <p className="notice" role="alert">
          {sensitive.includes('secret')
            ? 'This contains what looks like a password, key or token. Remove it before checking.'
            : `This contains ${sensitive.map((k) => SENSITIVE_TEXT[k]).join(' and ')}. It stays in this browser and is not saved, but remove it before sharing this output with anyone.`}
        </p>
      ) : null}
      <div className="lab-actions">
        <button type="button" className="btn" onClick={check}>Check output</button>
      </div>
      <div className={`lab-result ${status}`} role="status" aria-live="polite">
        <p><b>Verification:</b> {VERIFY_LINE[status]}{saved?.found && status !== 'pending' ? ` Found ${saved.found} on ${OS_LABELS[saved.os]}.` : ''}</p>
        {status === 'pending' ? <p className="hint">Press Check output to check what you pasted.</p> : null}
        {notice ? <p>{notice.text}{notice.next ? ` ${notice.next}` : ''}</p> : null}
        {why ? <p>{why.text}</p> : null}
        {why?.next ? <p><b>Next:</b> {why.next}</p> : null}
        {stale ? <p className="hint">{stale.os !== os ? `Your earlier result was for ${OS_LABELS[stale.os]}. Run the check again on ${OS_LABELS[os]}.` : 'This check has been updated since your last result. Run it again.'}</p> : null}
        {saved?.status === 'verified' && status !== 'pending' ? <p className="hint">This confirms the output you pasted, not your whole computer.</p> : null}
      </div>
    </div>
  );
}

export function Lab({ catalogue }: { catalogue: Software[] }) {
  const { user, ready } = useAccount();
  const [path, setPath] = useState<PathState>(emptyPath);
  const [loaded, setLoaded] = useState(false);
  const [suggested, setSuggested] = useState<Os | null>(null);
  const [wide, setWide] = useState(false);
  // Pasted text lives only in memory while the page is open. It is never written to storage.
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    setPath(withLab(readLocalPath() ?? emptyPath(), readMirror()));
    setSuggested(guessOs(navigator.userAgent));
    setWide(window.matchMedia('(min-width: 721px)').matches);
    setLoaded(true);
  }, []);

  // The thesis and the Lab share one saved copy. Writing it keeps every other part as it is.
  useEffect(() => {
    if (!loaded) return;
    put(PATH_KEY, JSON.stringify(path));
    const lab = cleanLab(path.lab);
    if (hasLabProgress(lab)) put(LAB_MIRROR_KEY, JSON.stringify(lab));
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

  const replace = useCallback((p: PathState) => setPath(withLab(p, readMirror())), []);
  const sync = usePathSync({ userId: ready ? user?.id : undefined, loaded, path, replace });

  const lab = cleanLab(path.lab) ?? emptyLab();
  const os = lab.os ?? suggested;
  const sel = { workTypes: lab.workTypes, os, gpu: lab.gpu };

  /** Builds on the newest copy in this browser, and changes only the Lab part. */
  const edit = (fn: (l: LabState) => LabState) =>
    setPath((p) => {
      const stored = readLocalPath();
      const latest = stored && (stored.savedAt ?? '') > (p.savedAt ?? '') ? stored : p;
      const base = cleanLab(latest.lab) ?? emptyLab();
      return { ...latest, lab: fn({ ...base, os: base.os ?? os }), savedAt: new Date().toISOString() };
    });

  const toggleType = (id: WorkType | 'python') => edit((l) => update(l, { workTypes: l.workTypes.includes(id) ? l.workTypes.filter((x) => x !== id) : [...l.workTypes, id] }));
  const tools = selectTools(catalogue, sel);
  const statuses = tools.map((t) => statusOf(lab.tools[t.id], os, drafts[t.id]));
  const n = (s: LabStatus) => statuses.filter((x) => x === s).length;
  const askGpu = os !== 'macos' && lab.workTypes.some((w) => GPU_TYPES.includes(w));
  const synced = !!user && hasWork(path);

  return (
    <>
      <h1>Lab</h1>
      <p className="lede">Set up your computer for the experiments in your research. Tell us what your project involves, and you get only the tools you need, with official links and checks.</p>
      <p className="hint" style={{ marginTop: 6 }}>If your research has no code or data analysis, you do not need this page.</p>
      <p className="notice pc-note" role="note">Installing happens on a computer, not on a phone. Read the steps here, then continue on your PC. You can paste check results here from either.</p>
      {sync.conflict ? <p className="notice" role="alert" style={{ marginTop: 12 }}>Two versions of your work exist. <Link href="/">Open My thesis</Link> to choose one.</p> : null}

      <div className="sheet" style={{ marginTop: 20 }}>
        <fieldset className="field">
          <legend><b>1. What does your research involve?</b></legend>
          <p className="hint">Choose all that apply.</p>
          <div className="choices">
            {WORK_TYPES.map((w) => (
              <label key={w.id} className="choice">
                <input type="checkbox" checked={lab.workTypes.includes(w.id)} onChange={() => toggleType(w.id)} />
                <span><b>{w.label}</b><span className="hint">{w.hint}</span></span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="field" style={{ marginTop: 18 }}>
          <legend><b>2. Which system is your research computer?</b></legend>
          <div className="choices row">
            {(Object.keys(OS_LABELS) as Os[]).map((o) => (
              <label key={o} className="choice">
                <input type="radio" name="os" checked={os === o} onChange={() => edit((l) => update(l, { os: o, osConfirmed: true }))} />
                <span>{OS_LABELS[o]}</span>
              </label>
            ))}
          </div>
          {os && !lab.osConfirmed && os === suggested ? <p className="hint" role="status">Suggested from your browser. Change it if your research computer is different.</p> : null}
          {!os ? <p className="hint">Choose the system of the computer where you will run experiments.</p> : null}
        </fieldset>

        {askGpu ? (
          <fieldset className="field" style={{ marginTop: 18 }}>
            <legend><b>3. Does that computer have an NVIDIA graphics card?</b></legend>
            <div className="choices row">
              {([['yes', 'Yes'], ['no', 'No'], ['not_sure', 'Not sure']] as [GpuAnswer, string][]).map(([v, l]) => (
                <label key={v} className="choice">
                  <input type="radio" name="gpu" checked={lab.gpu === v} onChange={() => edit((x) => update(x, { gpu: v }))} />
                  <span>{l}</span>
                </label>
              ))}
            </div>
            {lab.gpu === 'not_sure' ? <p className="hint">The NVIDIA card below shows how to check. Without one, you can still learn and test on the CPU.</p> : null}
          </fieldset>
        ) : null}
      </div>

      {tools.length ? (
        <>
          <h2 style={{ marginTop: 28 }}>Your setup checklist</h2>
          <p className="hint" role="status" data-testid="lab-summary">
            {tools.length} tools. {n('verified')} verified. {n('marked')} marked complete by you, not yet checked. {n('failed') + n('manual_review')} need attention.
          </p>
          <p className="hint">Follow them in order. Supervisor never runs commands on your computer: you run them, then paste what they print so Supervisor can check it.</p>
          <ol className="lab-list">
            {tools.map((t, i) => {
              const st = statuses[i];
              const tool = lab.tools[t.id];
              const steps = t.install[os!] ?? [];
              return (
                <li key={t.id} className="sheet lab-card">
                  <div className="lab-head">
                    <h3>{t.name}</h3>
                    <span className="tag">{t.level === 'recommended' ? 'Recommended' : t.level === 'conditional' ? 'Only if it applies' : 'Needed'}</span>
                  </div>
                  <p className={`lab-badge ${st}`} data-testid={`status-${t.id}`}>{STATUS_LABEL[st]}</p>
                  <p>{t.purpose}</p>
                  <p className="hint"><b>Version:</b> {t.version_guidance}</p>
                  <p className="lab-links">
                    <a href={t.official_download_url} target="_blank" rel="noopener noreferrer">Official download page ↗</a>
                    <a href={t.official_docs_url} target="_blank" rel="noopener noreferrer">Official documentation ↗</a>
                  </p>
                  <details open={wide}>
                    <summary>Installation steps for {OS_LABELS[os!]}</summary>
                    <ol className="todo">
                      {steps.map((s, k) => (
                        <li key={k}>
                          {s.text}
                          {s.command ? <CopyCommand command={s.command} /> : null}
                        </li>
                      ))}
                    </ol>
                  </details>
                  <div className="lab-status">
                    <label className="choice">
                      <input type="checkbox" checked={!!tool?.marked} onChange={() => edit((l) => setMarked(l, t.id, !l.tools[t.id]?.marked))} />
                      <span>I followed the installation steps</span>
                    </label>
                    <p className="hint"><b>Installation:</b> {tool?.marked ? 'Marked complete by you.' : 'Not started.'} A tick alone does not verify anything.</p>
                  </div>
                  <Verify tool={t} os={os!} gpu={lab.gpu} lab={lab} draft={drafts[t.id] ?? ''} setDraft={(v) => setDrafts((d) => ({ ...d, [t.id]: v }))} onResult={(r) => edit((l) => recordCheck(l, t.id, os!, r))} />
                  <details>
                    <summary>Common problems</summary>
                    <ul className="todo">{t.common_problems.map((p) => <li key={p.problem}><b>{p.problem}.</b> {p.solution}</li>)}</ul>
                  </details>
                </li>
              );
            })}
          </ol>
          <p className="hint" style={{ marginTop: 12 }}>
            {synced
              ? 'Your Lab progress is saved with your thesis in your account.'
              : user
                ? 'Your Lab progress is saved in this browser. It is saved to your account once you start your thesis.'
                : 'Your Lab progress is saved in this browser. Sign in and start your thesis to keep it in your account.'}{' '}
            Links were last reviewed on {tools[0].last_reviewed}. If a page looks different, follow the official page.
          </p>
        </>
      ) : loaded ? (
        <p className="empty" style={{ marginTop: 24 }}>{!lab.workTypes.length ? 'Choose what your research involves to see your checklist.' : 'Choose your system to see your checklist.'}</p>
      ) : null}
    </>
  );
}
