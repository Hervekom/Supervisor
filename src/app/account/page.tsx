'use client';
import { useState } from 'react';
import { useAccount } from '@/components/useAccount';
import { supabase } from '@/lib/supabase';

export default function AccountPage() {
  const { user, ready } = useAccount();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const db = supabase();
    if (!db) return setError('Accounts are not set up on this server.');
    setBusy(true);
    setError('');
    setMessage('');
    const { data, error: err } = mode === 'in'
      ? await db.auth.signInWithPassword({ email, password })
      : await db.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
    setBusy(false);
    if (err) return setError(err.message);
    if (mode === 'up' && !data.session) setMessage('Check your email and open the link to confirm your account.');
    setPassword('');
  }

  async function signOut() {
    await supabase()?.auth.signOut();
    try {
      localStorage.removeItem('path:v1');
    } catch {}
    setMessage('Signed out. Your work is saved to your account.');
  }

  return (
    <>
      <h1>{user ? 'Your account' : mode === 'in' ? 'Sign in' : 'Create your account'}</h1>
      <p className="lede">Your account keeps your thesis path on every device.</p>
      {!ready ? null : user ? (
        <div className="form" style={{ marginTop: 20 }}>
          <p>Signed in as <b>{user.email}</b></p>
          <div><button className="btn ghost" onClick={signOut}>Sign out</button></div>
        </div>
      ) : (
        <form className="form" style={{ marginTop: 20, maxWidth: 420 }} onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" minLength={8} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="ask">
            <button className="btn" disabled={busy}>{busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : 'Create account'}</button>
            <button type="button" className="btn ghost" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setError(''); setMessage(''); }}>
              {mode === 'in' ? 'Create an account' : 'I have an account'}
            </button>
          </div>
        </form>
      )}
      {error ? <p className="error" role="alert" style={{ marginTop: 12 }}>{error}</p> : null}
      {message ? <p className="notice" role="status" style={{ marginTop: 12 }}>{message}</p> : null}
    </>
  );
}
