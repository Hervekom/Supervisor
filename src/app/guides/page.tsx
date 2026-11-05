'use client';
import { useState } from 'react';
import { useProfiles } from '@/components/useProfiles';
import type { ImportResult } from '@/lib/profiles';
import { loadAi } from '@/lib/aiSettings';
import { errorText, fileProblem, request } from '@/lib/request';
import { authHeaders } from '@/lib/supabase';
import type { Profile } from '@/lib/types';

const STATE: Record<Profile['status'], string> = {
  extracted: 'Draft, not confirmed',
  student_confirmed: 'Confirmed by a student',
  institution_verified: 'Verified with the university',
};

export default function GuidesPage() {
  const { profiles, reload } = useProfiles();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [drop, setDrop] = useState<string[]>([]);

  async function upload(file: File) {
    setResult(null);
    const tooBig = fileProblem(file);
    if (tooBig) return setError(tooBig);
    setBusy(true);
    setError('');
    const f = new FormData();
    f.set('file', file);
    const ai = loadAi();
    if (ai) f.set('llm', JSON.stringify(ai));
    try {
      setResult(await request<ImportResult>('/api/profiles/import', { method: 'POST', body: f, headers: await authHeaders() }));
      setDrop([]);
      await reload();
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }
  async function act(id: string, method: 'PATCH' | 'DELETE', body?: unknown) {
    setError('');
    try {
      await request(`/api/profiles/${id}`, { method, headers: { 'content-type': 'application/json', ...(await authHeaders()) }, body: body ? JSON.stringify(body) : undefined });
      setResult(null);
      reload();
    } catch (x) {
      setError(errorText(x));
    }
  }

  return (
    <>
      <h1>University guides</h1>
      <p className="lede">Add your university’s writing guide. Supervisor keeps only the rules it can trace to a quote in the document, and you confirm them.</p>
      <div className="form" style={{ marginTop: 20 }}>
        <div className="field">
          <label htmlFor="g">Add a guide (PDF or .docx)</label>
          <input id="g" type="file" accept=".pdf,.docx" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </div>
        {busy ? <p className="hint" role="status">Reading the guide. This can take a minute.</p> : null}
        {error ? <p className="error" role="alert">{error}</p> : null}
      </div>
      {result ? (
        <div className="sheet" style={{ marginTop: 24, maxWidth: 860 }}>
          <h2>{result.profile.institution.name}</h2>
          <p className="lede">{result.kept} {result.kept === 1 ? 'rule' : 'rules'} found{result.dropped.length ? `. ${result.dropped.length} left out because their quote is not in the guide` : ''}. Untick any rule that is wrong.</p>
          {result.profile.rules.map((r) => (
            <div className="item" key={r.id}>
              <label>
                <input type="checkbox" checked={!drop.includes(r.id)} onChange={() => setDrop(drop.includes(r.id) ? drop.filter((x) => x !== r.id) : [...drop, r.id])} /> <b>{r.key}</b>: {JSON.stringify(r.value)}{r.unit ? ` ${r.unit}` : ''}
              </label>
              <blockquote>{r.source.quote}</blockquote>
              {r.source.page ? <p className="hint">Page {r.source.page}</p> : null}
            </div>
          ))}
          <button className="btn" style={{ marginTop: 16 }} onClick={() => act(result.profile.profile_id, 'PATCH', { removeRules: drop })}>Confirm these rules</button>
        </div>
      ) : null}
      <table className="table" style={{ marginTop: 28, maxWidth: 860 }}>
        <thead><tr><th>University</th><th>Rules</th><th>Open questions</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {profiles.map((p) => (
            <tr key={p.profile_id}>
              <td>{p.institution.name}</td>
              <td>{p.rules.length}</td>
              <td>{p.conflicts.filter((c) => c.status === 'open').length}</td>
              <td>{STATE[p.status]}</td>
              <td>{p.sources.length === 1 && p.status !== 'institution_verified' ? <button className="btn ghost" onClick={() => act(p.profile_id, 'DELETE')}>Delete</button> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
