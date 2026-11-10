'use client';
// Phase P7: passages from the student's own documents that bear on the current step, each with its document, page,
// section and the reason it was chosen. Nothing is sent anywhere unless the student asks the AI about chosen passages.
import Link from 'next/link';
import { useState } from 'react';
import { loadAi } from '@/lib/aiSettings';
import { CATEGORY_LABELS, excerpt, search, STEP_SECTIONS, where, type Hit } from '@/lib/docAnalysis';
import { effectiveMeta } from '@/lib/docStore';
import { stepState, type PathState, type Step } from '@/lib/path';
import { canRetry, errorText, requestAi } from '@/lib/request';
import type { Advice } from '@/lib/sourceAdvice';
import { authHeaders } from '@/lib/supabase';
import { useSourceDocs } from './useSourceDocs';

/** The student's research, in their words: the passages must share enough of these terms to be shown. */
export function researchQuery(path: PathState, step: Step) {
  const topic = [path.title, path.topic].filter(Boolean).join(' ');
  return topic.trim() ? topic : stepState(path, step.id).work.slice(0, 300);
}

export function SourceSuggestions({ step, path, language, onAiUse }: { step: Step; path: PathState; language?: string; onAiUse?: (tool: string) => void }) {
  const { docs, loaded } = useSourceDocs();
  const [chosen, setChosen] = useState<Set<number> | null>(null);
  const [busy, setBusy] = useState(false);
  const [advice, setAdvice] = useState<Advice | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(false);
  if (!loaded || !path.started) return null;
  const ready = docs.filter((d) => d.status === 'ready').map((d) => ({ ...d, meta: effectiveMeta(d) }));
  if (!ready.length) {
    return <p className="hint" style={{ marginTop: 12 }}>Add theses and papers you have collected in <Link href="/sources">My sources</Link>, and Supervisor will show what in them applies to this step.</p>;
  }
  const boost = STEP_SECTIONS[step.id] ?? [];
  const query = researchQuery(path, step);
  const hits: Hit[] = search(ready, query, { limit: 12, boost, minShare: 0.3 })
    .sort((a, b) => Number(boost.includes(b.passage.category)) - Number(boost.includes(a.passage.category)) || b.score - a.score)
    .slice(0, 3);
  const picked = chosen ?? new Set(hits.map((_, i) => i));
  const sent = hits.filter((_, i) => picked.has(i));
  const chars = sent.reduce((n, h) => n + Math.min(1200, h.passage.text.length), 0);

  async function ask() {
    setBusy(true);
    setError('');
    setRetry(false);
    try {
      const excerpts = sent.map((h) => ({ doc: h.title, where: where(h.passage), section: h.passage.section, text: h.passage.text.slice(0, 1200) }));
      setAdvice(await requestAi<Advice>('/api/sources/advise', { method: 'POST', headers: { 'content-type': 'application/json', ...(await authHeaders()) }, body: JSON.stringify({ stepId: step.id, topic: query, excerpts, language, llm: loadAi() ?? undefined }) }));
      onAiUse?.(`Sources: advice on ${sent.length} passage${sent.length === 1 ? '' : 's'} from the student's documents`);
    } catch (x) {
      setError(errorText(x));
      setRetry(canRetry(x));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="group" aria-label="From your sources">
      <h3>From your sources</h3>
      {!hits.length ? (
        <p className="hint">None of your {ready.length} documents has a passage close enough to your research for this step. Supervisor shows nothing rather than an unrelated source.</p>
      ) : (
        <>
          <ul className="todo">
            {hits.map((h, i) => (
              <li key={`${h.docId}-${h.passage.id}`} data-testid="source-hit">
                <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <input type="checkbox" aria-label={`Include the passage from ${h.title}, ${where(h.passage)}`} checked={picked.has(i)} onChange={() => { const s = new Set(picked); if (s.has(i)) s.delete(i); else s.add(i); setChosen(s); setAdvice(null); }} />
                  <span>
                    <b>{h.title}</b>, {where(h.passage)}{h.passage.section ? `, ${h.passage.section}` : ''}
                    <br />“{excerpt(h.passage.text, 40)}”
                    <br /><span className="hint">Why it may apply: it shares “{h.matched.slice(0, 5).join('”, “')}” with your research{boost.includes(h.passage.category) ? `, and it comes from the ${CATEGORY_LABELS[h.passage.category].toLowerCase()} part, which this step (“${step.title}”) draws on` : ''}. It is someone else’s work: cite it if you use it.</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <p className="hint">Asking Supervisor sends {sent.length ? `these ${sent.length} passage${sent.length === 1 ? '' : 's'} (${chars} characters)` : 'nothing yet: choose a passage'}, your topic and this step’s goal to your AI service. Nothing else from your documents is sent.</p>
          <div className="ask"><button type="button" className="btn ghost" disabled={busy || !sent.length} onClick={ask}>{busy ? 'Reading…' : 'Ask Supervisor how these apply'}</button></div>
          {error ? <p className="error" role="alert">{error}{/Account|Sign in/.test(error) ? <> <Link href="/account">Open Account</Link></> : null}{retry ? <> <button type="button" className="linklike" onClick={ask}>Try again</button></> : null}</p> : null}
          {advice ? (
            <div className="pen" aria-label="Advice on your sources">
              {advice.points.map((p) => {
                const h = sent[Number(p.excerpt.slice(1)) - 1];
                return (
                  <div className="item" key={p.excerpt}>
                    <h4>{h ? `${h.title}, ${where(h.passage)}` : p.excerpt}</h4>
                    <p>{p.why}</p>
                    {p.how ? <p><b>Your own work:</b> {p.how}</p> : null}
                    <p className="hint"><b>Cite:</b> {p.cite}</p>
                  </div>
                );
              })}
              {advice.unrelated.length ? <p className="hint">Not related to this step: {advice.unrelated.map((id) => { const h = sent[Number(id.slice(1)) - 1]; return h ? `${h.title}, ${where(h.passage)}` : id; }).join('; ')}.</p> : null}
              {!advice.points.length ? <p className="hint">Supervisor found nothing in these passages that helps with this step.</p> : null}
              {advice.caution ? <p className="notice">{advice.caution}</p> : null}
              <p className="hint">This is advice about other people’s work. Write your text yourself, and cite each idea, method or result you use.</p>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
