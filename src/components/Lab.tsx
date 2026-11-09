'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useAccount } from '@/components/useAccount';
import { put } from '@/components/useProfiles';
import { Runs } from '@/components/Runs';
import { usePathSync } from '@/components/usePathSync';
import { useLang } from '@/components/useLang';
import { LANGS, t as messages, type Lang, type Messages } from '@/lib/i18n';
import { cleanLab, currentCheck, emptyLab, fromLabV1, hasLabProgress, newerLab, recordCheck, setMarked, statusOf, update, type LabState, type LabStatus } from '@/lib/lab';
import { explain, findSensitive, VERIFY_COMMANDS, verifyOutput, type CheckResult } from '@/lib/labVerify';
import { emptyPath, isPathState, type PathState } from '@/lib/path';
import { hasWork, LAB_MIRROR_KEY, LAB_V1_KEY, PATH_KEY, readLocalPath } from '@/lib/pathSync';
import { guessOs, OS_LABELS, selectTools, textOf, WORK_TYPES, type GpuAnswer, type Os, type Software, type WorkType } from '@/lib/software';

const GPU_TYPES: (WorkType | 'python')[] = ['deep_learning', 'computer_vision', 'nlp'];
const PYTHON_ENV = new Set(['venv', 'jupyterlab', 'numpy', 'pandas', 'matplotlib', 'scikit-learn', 'pytorch']);

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

export function CopyCommand({ command, m }: { command: string; m: Messages }) {
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
      <button type="button" className="btn ghost" onClick={copy} aria-label={m.copyAria(command)}>{state === 'copied' ? m.copied : m.copy}</button>
      {state === 'failed' ? <span className="hint" role="status">{m.copyFailed}</span> : null}
    </div>
  );
}

function Verify({ tool, os, gpu, lab, draft, setDraft, onResult, lang }: { tool: Software; os: Os; gpu: GpuAnswer; lab: LabState; draft: string; setDraft: (v: string) => void; onResult: (r: CheckResult) => void; lang: Lang }) {
  const m = messages(lang);
  const [last, setLast] = useState<CheckResult | null>(null);
  const command = VERIFY_COMMANDS[tool.id]?.[os] ?? tool.verify[os]?.command ?? '';
  const expected = textOf(tool, lang).expected[os] ?? '';
  const sensitive = findSensitive(draft);
  const saved = currentCheck(lab.tools[tool.id], os);
  const stale = !saved ? lab.tools[tool.id]?.check : undefined;
  const status: LabStatus = statusOf(lab.tools[tool.id], os, draft);
  // Empty or blocked input is never saved, so its message comes from this visit only.
  const notice = last && (last.status === 'empty' || last.status === 'blocked') ? explain(last.reason, command, lang) : null;
  const why = saved && saved.status !== 'verified' && status !== 'pending' ? explain(saved.reason, command, lang) : null;
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
      <p><b>{m.checkItWorked}</b> {m.runThis(m.where[os], PYTHON_ENV.has(tool.id))}</p>
      <CopyCommand command={command} m={m} />
      <p className="hint"><b>{m.youShouldSee}</b> {expected}</p>
      <label htmlFor={fieldId}><b>{m.pasteLabel}</b></label>
      <p className="hint" id={`${fieldId}-hint`}>{m.pasteHint}</p>
      <textarea id={fieldId} aria-describedby={`${fieldId}-hint`} value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} spellCheck={false} autoCapitalize="off" autoCorrect="off" placeholder={m.pastePlaceholder(command)} />
      {sensitive.length ? (
        <p className="notice" role="alert">
          {sensitive.includes('secret') ? m.sensitiveSecret : m.sensitiveOther(sensitive.map((k) => m.sensitive[k]).join(m.and))}
        </p>
      ) : null}
      <div className="lab-actions">
        <button type="button" className="btn" onClick={check}>{m.checkOutput}</button>
      </div>
      <div className={`lab-result ${status}`} role="status" aria-live="polite">
        <p><b>{m.verificationLabel}</b> {m.verifyLine[status]}{saved?.found && status !== 'pending' ? m.found(saved.found, OS_LABELS[saved.os]) : ''}</p>
        {status === 'pending' ? <p className="hint">{m.pressCheck}</p> : null}
        {notice ? <p>{notice.text}{notice.next ? ` ${notice.next}` : ''}</p> : null}
        {why ? <p>{why.text}</p> : null}
        {why?.next ? <p><b>{m.next}</b> {why.next}</p> : null}
        {stale ? <p className="hint">{stale.os !== os ? m.staleOs(OS_LABELS[stale.os], OS_LABELS[os]) : m.staleRule}</p> : null}
        {saved?.status === 'verified' && status !== 'pending' ? <p className="hint">{m.verifiedNote}</p> : null}
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
  const [lang, saveLang] = useLang();
  const m = messages(lang);

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

  /** Builds on the newest copy in this browser. The caller changes only its own part. */
  const editPath = (fn: (p: PathState) => PathState) =>
    setPath((p) => {
      const stored = readLocalPath();
      const latest = stored && (stored.savedAt ?? '') > (p.savedAt ?? '') ? stored : p;
      return { ...fn(latest), savedAt: new Date().toISOString() };
    });
  const edit = (fn: (l: LabState) => LabState) =>
    editPath((p) => {
      const base = cleanLab(p.lab) ?? emptyLab();
      return { ...p, lab: fn({ ...base, os: base.os ?? os }) };
    });

  const toggleType = (id: WorkType | 'python') => edit((l) => update(l, { workTypes: l.workTypes.includes(id) ? l.workTypes.filter((x) => x !== id) : [...l.workTypes, id] }));
  const tools = selectTools(catalogue, sel);
  const statuses = tools.map((t) => statusOf(lab.tools[t.id], os, drafts[t.id]));
  const n = (s: LabStatus) => statuses.filter((x) => x === s).length;
  const askGpu = os !== 'macos' && lab.workTypes.some((w) => GPU_TYPES.includes(w));
  const synced = !!user && hasWork(path);

  return (
    <div lang={lang}>
      <div className="lab-top">
        <h1>{m.labTitle}</h1>
        <div className="lang-switch" role="group" aria-label={m.language}>
          {LANGS.map((l) => (
            <button key={l.id} type="button" lang={l.id} className={`btn ghost${lang === l.id ? ' on' : ''}`} aria-pressed={lang === l.id} onClick={() => saveLang(l.id)}>{l.label}</button>
          ))}
        </div>
      </div>
      <p className="lede">{m.labLede}</p>
      <p className="hint" style={{ marginTop: 6 }}>{m.noCodeHint}</p>
      <p className="notice pc-note" role="note">{m.pcNote}</p>
      {sync.conflict ? <p className="notice" role="alert" style={{ marginTop: 12 }}>{m.twoVersions} <Link href="/">{m.openMyThesis}</Link> {m.toChooseOne}</p> : null}

      <div className="sheet" style={{ marginTop: 20 }}>
        <fieldset className="field">
          <legend><b>{m.q1}</b></legend>
          <p className="hint">{m.chooseAll}</p>
          <div className="choices">
            {WORK_TYPES.map((w) => (
              <label key={w.id} className="choice">
                <input type="checkbox" checked={lab.workTypes.includes(w.id)} onChange={() => toggleType(w.id)} />
                <span><b>{m.workTypes[w.id][0]}</b><span className="hint">{m.workTypes[w.id][1]}</span></span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="field" style={{ marginTop: 18 }}>
          <legend><b>{m.q2}</b></legend>
          <div className="choices row">
            {(Object.keys(OS_LABELS) as Os[]).map((o) => (
              <label key={o} className="choice">
                <input type="radio" name="os" checked={os === o} onChange={() => edit((l) => update(l, { os: o, osConfirmed: true }))} />
                <span>{OS_LABELS[o]}</span>
              </label>
            ))}
          </div>
          {os && !lab.osConfirmed && os === suggested ? <p className="hint" role="status">{m.suggested}</p> : null}
          {!os ? <p className="hint">{m.chooseSystemHint}</p> : null}
        </fieldset>

        {askGpu ? (
          <fieldset className="field" style={{ marginTop: 18 }}>
            <legend><b>{m.q3}</b></legend>
            <div className="choices row">
              {([['yes', m.yes], ['no', m.no], ['not_sure', m.notSure]] as [GpuAnswer, string][]).map(([v, l]) => (
                <label key={v} className="choice">
                  <input type="radio" name="gpu" checked={lab.gpu === v} onChange={() => edit((x) => update(x, { gpu: v }))} />
                  <span>{l}</span>
                </label>
              ))}
            </div>
            {lab.gpu === 'not_sure' ? <p className="hint">{m.gpuNotSureHint}</p> : null}
          </fieldset>
        ) : null}
      </div>

      {tools.length ? (
        <>
          <h2 style={{ marginTop: 28 }}>{m.checklist}</h2>
          <p className="hint" role="status" data-testid="lab-summary">{m.summary(tools.length, n('verified'), n('marked'), n('failed') + n('manual_review'))}</p>
          <p className="hint">{m.followInOrder}</p>
          <ol className="lab-list">
            {tools.map((t, i) => {
              const st = statuses[i];
              const tool = lab.tools[t.id];
              const steps = t.install[os!] ?? [];
              const text = textOf(t, lang);
              return (
                <li key={t.id} className="sheet lab-card">
                  <div className="lab-head">
                    <h3>{t.name}</h3>
                    <span className="tag">{t.level === 'recommended' ? m.levelRecommended : t.level === 'conditional' ? m.levelConditional : m.levelRequired}</span>
                  </div>
                  <p className={`lab-badge ${st}`} data-testid={`status-${t.id}`}>{m.status[st]}</p>
                  <p>{text.purpose}</p>
                  <p className="hint"><b>{m.versionLabel}</b> {text.version_guidance}</p>
                  <p className="lab-links">
                    <a href={t.official_download_url} target="_blank" rel="noopener noreferrer">{m.downloadLink}</a>
                    <a href={t.official_docs_url} target="_blank" rel="noopener noreferrer">{m.docsLink}</a>
                  </p>
                  <details open={wide}>
                    <summary>{m.installSteps(OS_LABELS[os!])}</summary>
                    <ol className="todo">
                      {steps.map((s, k) => (
                        <li key={k}>
                          {text.install[os!]?.[k] ?? s.text}
                          {s.command ? <CopyCommand command={s.command} m={m} /> : null}
                        </li>
                      ))}
                    </ol>
                  </details>
                  <div className="lab-status">
                    <label className="choice">
                      <input type="checkbox" checked={!!tool?.marked} onChange={() => edit((l) => setMarked(l, t.id, !l.tools[t.id]?.marked))} />
                      <span>{m.followedSteps}</span>
                    </label>
                    <p className="hint"><b>{m.installationLabel}</b> {tool?.marked ? m.installMarked : m.installNotStarted} {m.tickNote}</p>
                  </div>
                  <Verify tool={t} os={os!} gpu={lab.gpu} lab={lab} draft={drafts[t.id] ?? ''} setDraft={(v) => setDrafts((d) => ({ ...d, [t.id]: v }))} onResult={(r) => edit((l) => recordCheck(l, t.id, os!, r))} lang={lang} />
                  <details>
                    <summary>{m.commonProblems}</summary>
                    <ul className="todo">{text.common_problems.map((p) => <li key={p.problem}><b>{p.problem}.</b> {p.solution}</li>)}</ul>
                  </details>
                </li>
              );
            })}
          </ol>
          <p className="hint" style={{ marginTop: 12 }}>
            {synced ? m.savedAccount : user ? m.savedHereSignedIn : m.savedHere} {m.linksReviewed(tools[0].last_reviewed)}
          </p>
        </>
      ) : loaded ? (
        <p className="empty" style={{ marginTop: 24 }}>{!lab.workTypes.length ? m.emptyTypes : m.emptySystem}</p>
      ) : null}

      {loaded ? <Runs path={path} os={os} editPath={editPath} lang={lang} /> : null}
    </div>
  );
}
