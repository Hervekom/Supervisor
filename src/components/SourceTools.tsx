'use client';
// Phase P8: AI-assisted analysis of one document, and comparison of several. Both only show what can be traced to a
// page or a section, and say plainly what was stated, what is interpretation, and what was not found.
import { useRef, useState } from 'react';
import { loadAi } from '@/lib/aiSettings';
import { where } from '@/lib/docAnalysis';
import { compareDocs, type CompareDoc } from '@/lib/docCompare';
import { ASPECTS, DEPTH, selectPassages, sentChars, toSent, type DeepAnalysis, type Depth } from '@/lib/deepAnalysis';
import { effectiveMeta, metaKeyOf, saveDoc, type SourceDoc } from '@/lib/docStore';
import { canRetry, errorText, requestAi } from '@/lib/request';
import { authHeaders } from '@/lib/supabase';

const KIND = { stated: 'Stated in the document', interpretation: 'AI interpretation' };

export function DeepPanel({ doc, onSaved }: { doc: SourceDoc; onSaved: () => void }) {
  const [depth, setDepth] = useState<Depth>(doc.deep?.depth ?? 'standard');
  const [language, setLanguage] = useState(doc.deep?.language ?? 'English');
  const [state, setState] = useState<'idle' | 'running' | 'failed' | 'cancelled'>('idle');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const meta = effectiveMeta(doc);
  const passages = selectPassages({ ...doc, meta }, depth);
  const chars = sentChars(passages);
  const deep = doc.deep;
  const stale = deep && (deep.metaKey !== metaKeyOf(doc) ? 'You corrected this document’s details after the analysis.' : deep.depth !== depth || deep.language !== language ? 'The settings below differ from those of this analysis.' : '');

  async function run() {
    setState('running');
    setError('');
    setRetry(false);
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      const r = await requestAi<{ aspects: DeepAnalysis['aspects']; dropped: number }>('/api/sources/analyse', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ title: meta.title ?? doc.fileName, passages: toSent(passages), language, llm: loadAi() ?? undefined }),
        signal: ctl.signal,
      });
      const analysis: DeepAnalysis = { at: new Date().toISOString(), examined: passages.map((p) => ({ id: p.id, where: where(p), section: p.section })), aspects: r.aspects, language, depth, metaKey: metaKeyOf(doc), dropped: r.dropped };
      await saveDoc({ ...doc, deep: analysis });
      setState('idle');
      onSaved();
    } catch (x) {
      if (ctl.signal.aborted) {
        setState('cancelled');
        return;
      }
      setState('failed');
      setError(errorText(x));
      setRetry(canRetry(x));
    } finally {
      abort.current = null;
    }
  }

  return (
    <section className="group" aria-label={`AI analysis of ${doc.fileName}`}>
      <h4>AI analysis</h4>
      <div className="compare-pick">
        <div className="field"><label htmlFor={`depth-${doc.id}`}>Depth</label><select id={`depth-${doc.id}`} value={depth} disabled={state === 'running'} onChange={(e) => setDepth(e.target.value as Depth)}>{(Object.keys(DEPTH) as Depth[]).map((k) => <option key={k} value={k}>{DEPTH[k].label}</option>)}</select></div>
        <div className="field"><label htmlFor={`lang-${doc.id}`}>Write the analysis in</label><select id={`lang-${doc.id}`} value={language} disabled={state === 'running'} onChange={(e) => setLanguage(e.target.value)}><option>English</option><option>French</option><option>Chinese</option></select></div>
      </div>
      <p className="hint">Sends {passages.length} passages of this document ({chars.toLocaleString('en')} characters), chosen for each aspect below, to your AI service. The rest of the document and the file itself are not sent. Each analysis counts as one AI request.</p>
      <div className="ask">
        {state === 'running' ? (
          <>
            <span role="status">Analysing {passages.length} passages…</span>
            <button type="button" className="btn ghost" onClick={() => abort.current?.abort()}>Cancel</button>
          </>
        ) : (
          <button type="button" className="btn ghost" disabled={!passages.length} onClick={run}>{deep ? 'Analyse again' : 'Analyse with AI'}</button>
        )}
      </div>
      {state === 'cancelled' ? <p className="hint" role="status">Cancelled. Nothing was changed{deep ? ': the earlier analysis is kept' : ''}.</p> : null}
      {state === 'failed' ? <p className="error" role="alert">{error}{retry ? <> <button type="button" className="linklike" onClick={run}>Try again</button></> : null}</p> : null}
      {deep ? (
        <div style={{ marginTop: 8 }}>
          <p className="hint">Analysed on {new Date(deep.at).toLocaleString()} ({DEPTH[deep.depth].label.toLowerCase()}, in {deep.language}). {deep.dropped ? `${deep.dropped} item${deep.dropped === 1 ? ' was' : 's were'} removed because ${deep.dropped === 1 ? 'it' : 'they'} could not be traced to the passages (a number or quotation not in them).` : ''}</p>
          {stale ? <p className="notice">{stale} Analyse again to update it.</p> : null}
          {ASPECTS.map((a) => {
            const asp = deep.aspects[a.key];
            return (
              <details key={a.key} open={asp?.status === 'found'}>
                <summary>{a.label}{asp?.status === 'found' ? ` (${asp.items.length})` : ': not found'}</summary>
                {asp?.status === 'found' ? (
                  <ul className="todo">
                    {asp.items.map((it, i) => {
                      const ex = deep.examined.find((e) => e.id === it.passage);
                      return (
                        <li key={i}>
                          <span className={it.kind === 'stated' ? 'tag' : 'tag blocking'}>{KIND[it.kind]}</span> {it.text}
                          {it.quote ? <><br /><span>“{it.quote}”</span></> : null}
                          <br /><span className="hint">{ex ? `${ex.where}${ex.section ? `, ${ex.section}` : ''}` : 'location not recorded'}</span>
                        </li>
                      );
                    })}
                  </ul>
                ) : <p className="hint">Not found in the {deep.examined.length} passages examined ({[...new Set(deep.examined.map((e) => e.section).filter(Boolean))].slice(0, 6).join(', ') || 'no section titles'}). It may be elsewhere in the document, or absent.</p>}
              </details>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

export function ComparePanel({ docs }: { docs: CompareDoc[] }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [shown, setShown] = useState<string[] | null>(null);
  if (docs.length < 2) return null;
  const chosen = docs.filter((d) => (shown ?? []).includes(d.id));
  const c = chosen.length >= 2 ? compareDocs(chosen) : null;
  return (
    <div className="sheet" style={{ marginTop: 16 }} aria-label="Compare documents">
      <h2>Compare documents</h2>
      <p className="hint">Choose two to four documents. Each cell shows what a document says, with its page. Documents analysed with AI show the analysis; the others show their own sentences.</p>
      <ul className="todo">
        {docs.map((d) => (
          <li key={d.id}><label style={{ display: 'flex', gap: 8 }}><input type="checkbox" checked={picked.includes(d.id)} disabled={!picked.includes(d.id) && picked.length >= 4} onChange={() => setPicked((p) => (p.includes(d.id) ? p.filter((x) => x !== d.id) : [...p, d.id]))} />{d.meta.title ?? d.fileName}</label></li>
        ))}
      </ul>
      <div className="ask"><button type="button" className="btn ghost" disabled={picked.length < 2} onClick={() => setShown(picked)}>Compare</button></div>
      {c ? (
        <div style={{ marginTop: 12 }}>
          <p className="notice">Two documents mentioning the same concept or name do not use it the same way, and different numbers are not directly comparable: check the data, settings and definitions on the pages given.</p>
          {c.conflicts.length ? (
            <section className="group" aria-label="Different values reported">
              <h3>Different values reported</h3>
              <ul className="todo">{c.conflicts.map((x) => <li key={x.metric}><b>{x.metric}</b>: {x.values.map((v) => `${v.title}: ${v.value} (${v.where}, “…${v.quote}”)`).join('; ')}.</li>)}</ul>
            </section>
          ) : null}
          {c.rows.map((r) => (
            <section className="group" key={r.key} aria-label={r.label}>
              <h3>{r.label}</h3>
              {r.names.length ? <p className="hint">The same name appears in all of them: {r.names.join(', ')}.</p> : null}
              {r.common.length ? <p className="hint">All of them mention: {r.common.join(', ')}. That alone does not make their approaches equivalent.</p> : null}
              <div className="compare-grid">
                {r.cells.map((cell, i) => (
                  <div key={c.docs[i].id}>
                    <h4>{c.docs[i].title}</h4>
                    {cell.length ? (
                      <ul className="todo">{cell.map((x, k) => <li key={k}>{x.source === 'ai' ? <span className={x.kind === 'stated' ? 'tag' : 'tag blocking'}>{x.kind === 'stated' ? 'Stated' : 'AI interpretation'} </span> : null}{x.source === 'document' ? `“${x.text}”` : x.text} <span className="hint">({x.where}{x.section ? `, ${x.section}` : ''})</span></li>)}</ul>
                    ) : <p className="hint">Not found.</p>}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}
