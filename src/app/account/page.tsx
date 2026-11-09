'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AiSettings } from '@/components/AiSettings';
import { RESET_PATH, useAccount } from '@/components/useAccount';
import { clearAi } from '@/lib/aiSettings';
import { authMessage, isNetworkFailure } from '@/lib/authMessages';
import { MESSAGES } from '@/lib/messages';
import { clearLocalCopy, confirmSynced, hasWork, labAtRisk, mergeLabMirror, readLabMirror, readLocalPath, syncNow, type LabRisk, type SignOutCheck } from '@/lib/pathSync';
import { cloudPaths, supabase } from '@/lib/supabase';

const NOT_SET_UP = 'Accounts are not set up on this server.';
const RESET_SENT = 'If an account exists for this email, a reset link is on its way. It can take a few minutes, so check your spam folder too.';
const HEADINGS = { in: 'Sign in', up: 'Create your account', reset: 'Reset your password' };

export default function AccountPage() {
  const { user, ready } = useAccount();
  const [mode, setMode] = useState<'in' | 'up' | 'reset'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [signOutProblem, setSignOutProblem] = useState<Exclude<SignOutCheck, 'ok'> | null>(null);
  const [labRisk, setLabRisk] = useState<LabRisk | null>(null);
  const [syncNote, setSyncNote] = useState('');
  const syncedFor = useRef('');

  // Work done before signing in is uploaded here, even if the student never returns to the thesis page.
  useEffect(() => {
    if (!user || syncedFor.current === user.id) return;
    syncedFor.current = user.id;
    if (!hasWork(readLocalPath())) return;
    setSyncNote('Saving the work from this browser to your account…');
    syncNow(user.id, cloudPaths)
      .then((r) => setSyncNote(r.state === 'conflict'
        ? 'Your account and this browser hold different work. Open My thesis to choose a version.'
        : 'The work from this browser is saved to your account.'))
      .catch(() => setSyncNote('The work from this browser is not confirmed as saved to your account yet. It is safe here, and we will try again when you open My thesis.'));
  }, [user]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const db = supabase();
    if (!db) return setError(NOT_SET_UP);
    setBusy(true);
    setError('');
    setMessage('');
    if (mode === 'reset') {
      const { error: err } = await db.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}${RESET_PATH}` });
      setBusy(false);
      // The reply is the same whether or not the address has an account.
      if (err && isNetworkFailure(err)) return setError(MESSAGES.network);
      setMessage(RESET_SENT);
      return;
    }
    const { data, error: err } = mode === 'in'
      ? await db.auth.signInWithPassword({ email, password })
      : await db.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
    setBusy(false);
    if (err) return setError(authMessage(err, mode === 'in' ? 'sign_in' : 'sign_up'));
    if (mode === 'up' && !data.session) setMessage('Check your email and open the link to confirm your account.');
    setPassword('');
  }

  async function finishSignOut(note: string, scope?: 'local') {
    const { error: err } = (await supabase()?.auth.signOut(scope ? { scope } : undefined)) ?? { error: null };
    if (err) {
      setError(MESSAGES.network);
      return false;
    }
    clearAi();
    setSignOutProblem(null);
    setSyncNote('');
    syncedFor.current = '';
    setMessage(note);
    return true;
  }

  /** `lab` is what to do with Lab progress that cannot reach the account: ask first, keep it here, or delete it. */
  async function signOut(lab: 'ask' | 'keep' | 'delete' = 'ask') {
    if (!user) return;
    setBusy(true);
    setError('');
    setMessage('');
    setSyncNote('');
    // Newer Lab progress joins the thesis copy, so the normal save below sends it to the account.
    mergeLabMirror();
    const risk = labAtRisk(readLocalPath(), readLabMirror());
    if (risk && lab === 'ask') {
      setLabRisk(risk);
      setBusy(false);
      return;
    }
    setLabRisk(null);
    const check = await confirmSynced(user.id, cloudPaths);
    if (check !== 'ok') setSignOutProblem(check);
    else if (await finishSignOut(risk && lab === 'keep' ? 'Signed out. Your thesis work is saved to your account. Your Lab progress stays in this browser.' : 'Signed out. Your work is saved to your account.')) clearLocalCopy({ keepLab: !!risk && lab === 'keep' });
    setBusy(false);
  }

  async function signOutKeepingCopy() {
    setBusy(true);
    await finishSignOut('Signed out. Your latest work is only in this browser. Sign in here again to save it to your account.', 'local');
    setBusy(false);
  }

  const setForm = (next: 'in' | 'up' | 'reset') => {
    setMode(next);
    setError('');
    setMessage('');
  };

  return (
    <>
      <h1>{user ? 'Your account' : HEADINGS[mode]}</h1>
      <p className="lede">Your account keeps your thesis path on every device. Sign in to add your own AI key.</p>
      {!ready ? null : user ? (
        <div className="form" style={{ marginTop: 20 }}>
          <p>Signed in as <b>{user.email}</b></p>
          {syncNote ? <p className="hint" role="status">{syncNote}</p> : null}
          <div><button className="btn ghost" disabled={busy} onClick={() => signOut()}>{busy ? 'Checking your work is saved…' : 'Sign out'}</button></div>
          {labRisk ? (
            <div className="notice" role="alertdialog" aria-labelledby="lab-risk-title" aria-describedby="lab-risk-text">
              <p id="lab-risk-title"><b>Your Lab progress is not saved to your account.</b></p>
              <p id="lab-risk-text">
                This browser holds {labRisk.verified} verified tool{labRisk.verified === 1 ? '' : 's'}, {labRisk.checked} check result{labRisk.checked === 1 ? '' : 's'} in total and {labRisk.marked} tick{labRisk.marked === 1 ? '' : 's'}.
                Lab progress is saved to your account only once you start your thesis. Signing out normally deletes it from this browser.
              </p>
              <div className="ask" style={{ marginTop: 10 }}>
                <button className="btn" disabled={busy} onClick={() => signOut('keep')}>Keep it in this browser and sign out</button>
                <button className="btn ghost" disabled={busy} onClick={() => signOut('delete')}>Delete it and sign out</button>
                <button className="btn ghost" disabled={busy} onClick={() => setLabRisk(null)}>Cancel</button>
              </div>
              <p className="hint">If you keep it, anyone using this browser can see which tools you checked. Nothing about your thesis is kept.</p>
            </div>
          ) : null}
          {signOutProblem ? (
            <div className="notice" role="alert">
              <p>
                {signOutProblem === 'conflict'
                  ? <>Your account and this browser hold different work, so you are still signed in. <Link href="/">Open My thesis</Link> to choose a version.</>
                  : 'We could not confirm that your latest work is saved to your account, so you are still signed in and nothing was deleted.'}
              </p>
              <div className="ask" style={{ marginTop: 10 }}>
                {signOutProblem === 'failed' ? <button className="btn" disabled={busy} onClick={() => signOut()}>Try again</button> : null}
                <button className="btn ghost" disabled={busy} onClick={signOutKeepingCopy}>Sign out and keep my work in this browser</button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <form className="form" style={{ marginTop: 20, maxWidth: 420 }} onSubmit={submit}>
          {mode === 'reset' ? <p className="hint">Enter your email and we will send you a link to choose a new password.</p> : null}
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {mode === 'reset' ? null : (
            <div className="field">
              <label htmlFor="password">Password</label>
              <input id="password" type="password" minLength={8} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          )}
          <div className="ask">
            <button className="btn" disabled={busy}>{busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create account' : 'Send reset link'}</button>
            {mode === 'reset' ? (
              <button type="button" className="btn ghost" onClick={() => setForm('in')}>Back to sign in</button>
            ) : (
              <button type="button" className="btn ghost" onClick={() => setForm(mode === 'in' ? 'up' : 'in')}>
                {mode === 'in' ? 'Create an account' : 'I have an account'}
              </button>
            )}
          </div>
          {mode === 'in' ? <p className="hint"><button type="button" className="linklike" onClick={() => setForm('reset')}>Forgot your password?</button></p> : null}
        </form>
      )}
      {error ? <p className="error" role="alert" style={{ marginTop: 12 }}>{error}</p> : null}
      {user || !supabase() ? <AiSettings /> : null}
      {message ? <p className="notice" role="status" style={{ marginTop: 12 }}>{message}</p> : null}
    </>
  );
}
