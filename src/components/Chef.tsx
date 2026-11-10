'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { loadAi } from '@/lib/aiSettings';
import { chefContext, nextMove, type ChefMessage, type ChefReply } from '@/lib/chef';
import { CHEF_KEY, readLocalPath, writeLocalPath, PATH_KEY } from '@/lib/pathSync';
import { canRetry, errorText, requestAi } from '@/lib/request';
import { authHeaders } from '@/lib/supabase';

type Line = ChefMessage & { step?: string };

const readChat = (): Line[] => {
  try {
    const v = JSON.parse(localStorage.getItem(CHEF_KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};
const saveChat = (l: Line[]) => {
  try {
    localStorage.setItem(CHEF_KEY, JSON.stringify(l.slice(-40)));
  } catch {}
};

/** Tells open pages that the saved path changed in this tab. */
function savePath(p: NonNullable<ReturnType<typeof readLocalPath>>) {
  writeLocalPath(p);
  window.dispatchEvent(new StorageEvent('storage', { key: PATH_KEY, newValue: JSON.stringify(p) }));
}

export function Chef() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState<(() => void) | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'nearest' });
  }, [lines, busy, open]);

  function show() {
    const saved = readChat();
    const move = nextMove(readLocalPath());
    setLines(saved.length ? saved : [{ role: 'chef', content: move.text }]);
    setSuggestions(move.suggestions);
    setError('');
    setOpen(true);
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    const next: Line[] = [...lines, { role: 'student', content }];
    setLines(next);
    saveChat(next);
    setDraft('');
    setSuggestions([]);
    setError('');
    setRetry(null);
    setBusy(true);
    try {
      const path = readLocalPath();
      const j = await requestAi<ChefReply>('/api/chef', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ context: chefContext(path), messages: next.map(({ role, content: c }) => ({ role, content: c })), llm: loadAi() ?? undefined }),
      });
      const done: Line[] = [...next, { role: 'chef', content: j.reply, step: j.step }];
      setLines(done);
      saveChat(done);
      setSuggestions(j.suggestions);
      if (path && !next.slice(0, -1).some((l) => l.role === 'student')) {
        savePath({ ...path, savedAt: new Date().toISOString(), log: [...path.log, { at: new Date().toISOString(), step: path.current, tool: 'Conversation with Supervisor' }] });
      }
    } catch (x) {
      // Phase P4: the message was not answered, so it goes back into the box, ready to send again.
      setLines(lines);
      saveChat(lines);
      setDraft(content);
      setError(errorText(x));
      if (canRetry(x)) setRetry(() => () => send(content));
    } finally {
      setBusy(false);
    }
  }

  function openStep(step: string) {
    const path = readLocalPath();
    if (!path) return;
    savePath({ ...path, current: step, savedAt: new Date().toISOString() });
    if (pathname !== '/') window.location.href = '/';
  }

  function restart() {
    saveChat([]);
    const move = nextMove(readLocalPath());
    setLines([{ role: 'chef', content: move.text }]);
    setSuggestions(move.suggestions);
    setError('');
  }

  if (pathname === '/account/reset') return null;
  if (!open) return <button className="btn chef-open" onClick={show}>Ask Supervisor</button>;

  return (
    <section className="chef" aria-label="Conversation with Supervisor">
      <header>
        <b>Supervisor</b>
        <span>
          <button className="linklike" onClick={restart}>New conversation</button>
          <button className="linklike" aria-label="Close the conversation" onClick={() => setOpen(false)}>Close</button>
        </span>
      </header>
      <div className="chef-log" role="log" aria-live="polite">
        {lines.map((l, i) => (
          <div key={i} className={`chef-line ${l.role === 'chef' ? 'bot' : 'student'}`}>
            <p>{l.content}</p>
            {l.step ? <button className="linklike" onClick={() => openStep(l.step!)}>Open this step</button> : null}
          </div>
        ))}
        {busy ? <p className="hint" role="status">Supervisor is thinking…</p> : null}
        {error ? <p className="error" role="alert">{error}{/Account|Sign in/.test(error) ? <> <Link href="/account">Open Account</Link></> : null}{retry ? <> <button type="button" className="linklike" disabled={busy} onClick={() => retry()}>Try again</button></> : null}</p> : null}
        <div ref={end} />
      </div>
      {suggestions.length ? <div className="chef-chips">{suggestions.map((s) => <button key={s} className="btn ghost" disabled={busy} onClick={() => send(s)}>{s}</button>)}</div> : null}
      <form onSubmit={(e) => { e.preventDefault(); send(draft); }}>
        <textarea aria-label="Your message" rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(draft); } }} placeholder="Ask anything, or say you’re stuck" />
        <button className="btn" disabled={busy || !draft.trim()}>Send</button>
      </form>
      <p className="hint">Supervisor guides you and won’t write your thesis. Your messages go to the AI service.</p>
    </section>
  );
}
