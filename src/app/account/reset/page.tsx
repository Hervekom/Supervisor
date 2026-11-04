'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { authMessage } from '@/lib/authMessages';
import { supabase } from '@/lib/supabase';

type LinkState = 'checking' | 'valid' | 'invalid' | 'done';

export default function ResetPasswordPage() {
  const [link, setLink] = useState<LinkState>('checking');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Read before the Auth client clears the address. A signed-in visit without a link is not enough.
    const hash = window.location.hash;
    const recovery = /type=recovery/.test(hash) && !/error/.test(hash);
    const db = supabase();
    if (!recovery || !db) return setLink('invalid');
    db.auth.getSession().then(({ data }) => setLink(data.session ? 'valid' : 'invalid')).catch(() => setLink('invalid'));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 8) return setError('Use at least 8 characters.');
    if (password !== repeat) return setError('The two passwords do not match.');
    const db = supabase();
    if (!db) return setLink('invalid');
    setBusy(true);
    const { error: err } = await db.auth.updateUser({ password });
    setBusy(false);
    if (err) return setError(authMessage(err, 'update'));
    setPassword('');
    setRepeat('');
    setLink('done');
  }

  return (
    <>
      <h1>Choose a new password</h1>
      {link === 'checking' ? <p className="hint" role="status">Checking your reset link…</p> : null}
      {link === 'invalid' ? (
        <div className="form" style={{ marginTop: 20, maxWidth: 480 }}>
          <p className="notice" role="alert">This link is invalid or has expired. Reset links work once, for a limited time.</p>
          <div><Link className="btn linkbtn" href="/account">Request a new link</Link></div>
        </div>
      ) : null}
      {link === 'done' ? (
        <div className="form" style={{ marginTop: 20, maxWidth: 480 }}>
          <p className="notice" role="status">Your password has been changed.</p>
          <div><Link className="btn linkbtn" href="/">Continue to My thesis</Link></div>
        </div>
      ) : null}
      {link === 'valid' ? (
        <form className="form" style={{ marginTop: 20, maxWidth: 420 }} onSubmit={submit}>
          <div className="field">
            <label htmlFor="new-password">New password</label>
            <input id="new-password" type="password" minLength={8} autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="repeat-password">Repeat new password</label>
            <input id="repeat-password" type="password" minLength={8} autoComplete="new-password" required value={repeat} onChange={(e) => setRepeat(e.target.value)} />
          </div>
          <div><button className="btn" disabled={busy}>{busy ? 'Please wait…' : 'Change my password'}</button></div>
          {error ? <p className="error" role="alert">{error}</p> : null}
        </form>
      ) : null}
    </>
  );
}
