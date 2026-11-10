'use client';
import { useEffect, useState } from 'react';
import { clearAi, loadAi, saveAi } from '@/lib/aiSettings';
import { CRITIC_NAME } from '@/lib/brand';
import { PROVIDERS } from '@/lib/providers';
import { errorText, request } from '@/lib/request';
import { AiLimitsNote } from './AiStatus';
import { authHeaders } from '@/lib/supabase';

export function AiSettings() {
  const [provider, setProvider] = useState(PROVIDERS[0].id);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const v = loadAi();
    if (!v) return;
    setProvider(v.provider);
    setBaseUrl(v.baseUrl ?? '');
    setApiKey(v.apiKey);
    setModel(v.model);
    setSaved(true);
  }, []);

  const choice = () => ({ provider, baseUrl: provider === 'custom' ? baseUrl.trim() : undefined, apiKey: apiKey.trim(), model: model.trim() });
  const links = PROVIDERS.find((p) => p.id === provider);

  async function test() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await request('/api/ai/test', { method: 'POST', headers: { 'content-type': 'application/json', ...(await authHeaders()) }, body: JSON.stringify({ llm: choice() }) });
      setMessage('Your AI is working.');
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!apiKey.trim() || !model.trim() || (provider === 'custom' && !baseUrl.trim())) return setError('Complete each field first.');
    if (!saveAi(choice())) return setError('This browser blocked saving. Check its storage settings.');
    setSaved(true);
    setMessage(`${CRITIC_NAME} will use your AI.`);
  }

  function remove() {
    clearAi();
    setApiKey('');
    setModel('');
    setSaved(false);
    setError('');
    setMessage('Your key was removed from this browser.');
  }

  return (
    <form className="form sheet" style={{ marginTop: 24, maxWidth: 620 }} onSubmit={save}>
      <div>
        <h2>Your AI</h2>
        <p className="hint" style={{ marginTop: 4 }}>Choose the AI that powers {CRITIC_NAME}. You pay your provider directly.</p>
      </div>
      <div className="field">
        <label htmlFor="ai-provider">Provider</label>
        <select id="ai-provider" value={provider} onChange={(e) => setProvider(e.target.value)}>
          {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          <option value="custom">Other OpenAI-compatible service</option>
        </select>
        {links ? <p className="hint"><a href={links.keysUrl} target="_blank" rel="noreferrer">Get a key from {links.name}</a></p> : null}
      </div>
      {provider === 'custom' ? (
        <div className="field">
          <label htmlFor="ai-url">Service address</label>
          <input id="ai-url" type="url" placeholder="https://api.example.com/v1" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        </div>
      ) : null}
      <div className="field">
        <label htmlFor="ai-model">Model name</label>
        <input id="ai-model" spellCheck={false} autoComplete="off" value={model} onChange={(e) => setModel(e.target.value)} />
        <p className="hint">Copy the exact name from your provider’s model list.</p>
      </div>
      <div className="field">
        <label htmlFor="ai-key">API key</label>
        <input id="ai-key" type="password" spellCheck={false} autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
      </div>
      <div className="ask">
        <button className="btn">Save my AI</button>
        <button type="button" className="btn ghost" disabled={busy} onClick={test}>{busy ? 'Testing…' : 'Test connection'}</button>
        {saved ? <button type="button" className="btn ghost" onClick={remove}>Remove my key</button> : null}
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {message ? <p className="notice" role="status">{message}</p> : null}
      <AiLimitsNote ownKey={saved} />
      <p className="hint">Your key stays in this browser, not in your account. Each critique sends it through Supervisor’s server to your provider, and it is not stored there. Your work goes to the provider you choose, so check its data policy. Use this only on your own device.</p>
    </form>
  );
}
