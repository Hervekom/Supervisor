'use client';
import Link from 'next/link';
import { useState } from 'react';
import { loadAi } from '@/lib/aiSettings';
import { FORM_EXAMPLE, MAX_QUESTIONS, STARTERS, type DraftAnswer, type PlanPoint } from '@/lib/draftHelp';
import { canRetry, errorText, requestAi } from '@/lib/request';
import { authHeaders } from '@/lib/supabase';

type Review = { missing: string[]; question: string };
type Props = { stepId: string; degree: string; topic: string; discipline: string; history: string; language: string; lastParagraph: string; onUse: (tool: string) => void };

export function DraftHelper({ stepId, degree, topic, discipline, history, language, lastParagraph, onUse }: Props) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [answers, setAnswers] = useState<DraftAnswer[]>([]);
  const [plan, setPlan] = useState<PlanPoint[] | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState<(() => void) | null>(null);

  async function call<T>(extra: object) {
    return requestAi<T>('/api/draft-help', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ stepId, degree, topic, discipline, history, language, llm: loadAi() ?? undefined, ...extra }),
    });
  }

  async function advance(next: DraftAnswer[]) {
    setBusy(true);
    setError('');
    setRetry(null);
    try {
      const j = await call<{ question?: string; plan?: PlanPoint[] }>({ answers: next });
      setAnswers(next);
      setAnswer('');
      if (j.plan) {
        setPlan(j.plan);
        setQuestion('');
        onUse('Guided writing: plan from the student’s answers');
      } else {
        setQuestion(j.question ?? '');
        if (!next.length) onUse('Guided writing: questions');
      }
    } catch (x) {
      setError(errorText(x));
      if (canRetry(x)) setRetry(() => () => advance(next));
    } finally {
      setBusy(false);
    }
  }

  async function check() {
    setBusy(true);
    setError('');
    setRetry(null);
    try {
      const j = await call<{ review: Review }>({ paragraph: lastParagraph });
      setReview(j.review);
      onUse('Guided writing: paragraph check');
    } catch (x) {
      setError(errorText(x));
      if (canRetry(x)) setRetry(() => check);
    } finally {
      setBusy(false);
    }
  }

  const started = !!question || !!plan;

  return (
    <div className="now" style={{ marginTop: 12 }}>
      <h3>Let’s find what to say</h3>
      <p className="hint">Supervisor asks, you answer in your own words, and you write the text. It will not write it for you.</p>

      {!started ? <p style={{ marginTop: 10 }}><button className="btn" disabled={busy} onClick={() => advance([])}>{busy ? 'Thinking…' : 'Ask me a question'}</button></p> : null}

      {question ? (
        <div className="field" style={{ marginTop: 10 }}>
          <p className="hint">Question {answers.length + 1} of {MAX_QUESTIONS}</p>
          <label htmlFor="draft-answer">{question}</label>
          <textarea id="draft-answer" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Answer roughly. Notes are fine." />
          <div><button className="btn" disabled={busy || !answer.trim()} onClick={() => advance([...answers, { question, answer: answer.trim() }])}>{busy ? 'Thinking…' : 'Next'}</button></div>
        </div>
      ) : null}

      {plan ? (
        <>
          <h3 style={{ marginTop: 14 }}>Your plan</h3>
          <p className="hint">Built only from your answers. Write each point in your own sentences.</p>
          <ol>{plan.map((p) => <li key={p.point}>{p.point}{p.evidence ? <span className="hint"> Evidence to find: {p.evidence}</span> : null}</li>)}</ol>
          <details>
            <summary>Ways to start a sentence</summary>
            <ul className="todo">{STARTERS.map((s) => <li key={s}>{s}</li>)}</ul>
          </details>
          <details>
            <summary>See the shape on a different topic</summary>
            <blockquote>{FORM_EXAMPLE}</blockquote>
          </details>
          <p style={{ marginTop: 10 }}><button className="btn ghost" disabled={busy || lastParagraph.trim().length < 20} onClick={check}>{busy ? 'Reading…' : 'Check my last paragraph'}</button></p>
          {review ? (
            <div style={{ marginTop: 8 }}>
              {review.missing.length ? <ul className="todo">{review.missing.map((m) => <li key={m}>{m}</li>)}</ul> : null}
              {review.question ? <p><b>Ask yourself:</b> {review.question}</p> : null}
            </div>
          ) : null}
        </>
      ) : null}

      {error ? <p className="error" role="alert" style={{ marginTop: 8 }}>{error}{/Account|Sign in/.test(error) ? <> <Link href="/account">Open Account</Link></> : null}{retry ? <> <button type="button" className="linklike" disabled={busy} onClick={() => retry()}>Try again</button></> : null}</p> : null}
    </div>
  );
}
