'use client';
import Link from 'next/link';
import { useLang } from '@/components/useLang';
import { t } from '@/lib/i18n';
import type { PathState } from '@/lib/path';
import { researchCounts } from '@/lib/research';
import { stepTitle } from '@/lib/runs';

export function ResearchEvidence({ path }: { path: PathState }) {
  const [lang] = useLang();
  const m = t(lang);
  const c = researchCounts(path);
  return (
    <section className="sheet research" aria-labelledby="research-title" lang={lang} style={{ marginTop: 16 }} data-testid="research-evidence">
      <h2 id="research-title">{m.research}</h2>
      {!c.hasLab && !c.runs ? (
        <>
          <p className="hint">{m.researchEmpty}</p>
          <p style={{ marginTop: 8 }}><Link className="btn ghost linkbtn" href="/lab">{m.openLab}</Link></p>
        </>
      ) : (
        <>
          <p className="hint">{m.researchHint}</p>
          <div className="research-grid">
            <div>
              <h3>{m.environment}</h3>
              {c.verified || c.pending || c.attention ? (
                <ul className="research-counts">
                  <li>{m.envVerified(c.verified)}</li>
                  {c.pending ? <li>{m.envPending(c.pending)}</li> : null}
                  {c.attention ? <li>{m.envAttention(c.attention)}</li> : null}
                </ul>
              ) : (
                <p className="hint">{m.envNone}</p>
              )}
              {c.latest ? <p className="hint">{m.envLatest(c.latest.slice(0, 10))}</p> : null}
            </div>
            <div>
              <h3>{m.experiments}</h3>
              {c.runs ? (
                <ul className="research-counts">
                  <li>{m.runsTotal(c.runs)}</li>
                  <li>{m.runsCompleted(c.completed)}</li>
                  {c.failed ? <li>{m.runsFailed(c.failed)}</li> : null}
                  <li>{m.runsLinked(c.linked)}</li>
                  {c.unassigned ? <li><Link href="/lab?step=none#runs">{m.runsUnassigned(c.unassigned)}</Link></li> : null}
                </ul>
              ) : (
                <p className="hint">{m.noRuns}</p>
              )}
            </div>
          </div>
          {c.byStep.length ? (
            <>
              <h3 style={{ marginTop: 12 }}>{m.runsByStep}</h3>
              <ul className="research-counts">
                {c.byStep.map((s) => (
                  <li key={s.id}><Link href={`/lab?step=${s.id}#runs`}>{stepTitle(s.id, lang)}</Link>: {s.n}</li>
                ))}
              </ul>
            </>
          ) : null}
          <p style={{ marginTop: 10 }}><Link className="btn ghost linkbtn" href="/lab">{m.openInLab}</Link></p>
        </>
      )}
    </section>
  );
}
