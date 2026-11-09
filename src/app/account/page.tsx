'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AiSettings } from '@/components/AiSettings';
import { RESET_PATH, useAccount } from '@/components/useAccount';
import { clearAi } from '@/lib/aiSettings';
import { authMessage, isNetworkFailure } from '@/lib/authMessages';
import { MESSAGES } from '@/lib/messages';
import { SetAsideList, downloadSetAside } from '@/components/SetAsideList';
import { useDialogFocus } from '@/components/useDialogFocus';
import { adoptSessionGuest, identityFor, readLabFor } from '@/lib/labOwner';
import { clearLocalCopy, confirmSynced, hasWork, labAtRisk, mergeLabMirror, readLocalPath, setAsideFor, syncNow, type LabRisk, type SetAside, type SignOutCheck } from '@/lib/pathSync';
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
  // What signing out would remove that is not in the account: Lab progress without a thesis, and set-aside versions.
  const [review, setReview] = useState<{ lab: LabRisk | null; copies: SetAside[] } | null>(null);
  const [copies, setCopies] = useState<SetAside[]>([]);
  const signOutButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const closeReview = useCallback(() => setReview(null), []);
  useDialogFocus(dialog, !!review, closeReview, signOutButton);
  const several = !!review && ((!!review.lab && review.copies.length > 0) || review.copies.length > 1);
  useEffect(() => {
    if (user) setCopies(setAsideFor(user.id));
  }, [user]);
  const [syncNote, setSyncNote] = useState('');
  const syncedFor = useRef('');

  // Work done before signing in is uploaded here, even if the student never returns to the thesis page.
  useEffect(() => {
    if (!user || syncedFor.current === user.id) return;
    syncedFor.current = user.id;
    // Signing in from the same tab continues the same person's work: progress made signed out in this tab joins the account.
    adoptSessionGuest(user.id);
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

  /**
   * `choice` is what to do with what the account does not hold: ask first, keep it in this browser, or delete it.
   * Nothing is deleted without the student's choice.
   */
  async function signOut(choice: 'ask' | 'keep' | 'delete' = 'ask') {
    if (!user) return;
    setBusy(true);
    setError('');
    setMessage('');
    setSyncNote('');
    const owner = identityFor(user.id);
    adoptSessionGuest(user.id);
    // Newer Lab progress of this account joins its thesis copy, so the normal save sends it to the account.
    mergeLabMirror(owner);
    const lab = labAtRisk(readLocalPath(), readLabFor(owner));
    const kept = setAsideFor(user.id);
    if ((lab || kept.length) && choice === 'ask') {
      setReview({ lab, copies: kept });
      setBusy(false);
      return;
    }
    setReview(null);
    const check = await confirmSynced(user.id, cloudPaths);
    const keep = choice === 'keep';
    if (check !== 'ok') setSignOutProblem(check);
    else if (await finishSignOut(keep && (lab || kept.length) ? `Signed out. Your thesis work is saved to your account.${lab ? ' Your Lab progress stays in this browser.' : ''}${kept.length ? ` The set-aside version${kept.length === 1 ? ' stays' : 's stay'} in this browser.` : ''}` : 'Signed out. Your work is saved to your account.'))
      clearLocalCopy({ keepLab: keep && !!lab, keepSetAside: keep, labOwner: owner, userId: user.id });
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
          <div><button ref={signOutButton} className="btn ghost" disabled={busy} onClick={() => signOut()}>{busy ? 'Checking your work is saved…' : 'Sign out'}</button></div>
          {review ? (
            <div className="notice" role="alertdialog" aria-modal="true" aria-labelledby="review-title" aria-describedby="review-text" ref={dialog}>
              <p id="review-title"><b>Before you sign out</b></p>
              <div id="review-text">
                {review.lab ? (
                  <p>
                    <b>Your Lab progress is not saved to your account.</b> This browser holds {review.lab.verified} verified tool{review.lab.verified === 1 ? '' : 's'}, {review.lab.checked} check result{review.lab.checked === 1 ? '' : 's'} in total and {review.lab.marked} tick{review.lab.marked === 1 ? '' : 's'}. Lab progress is saved to your account only once you start your thesis.
                  </p>
                ) : null}
                {review.copies.length ? (
                  <p>
                    <b>{review.copies.length} set-aside version{review.copies.length === 1 ? '' : 's'} of your work {review.copies.length === 1 ? 'is' : 'are'} kept in this browser.</b> They were set aside when you chose between two versions. They are not part of your account’s current version, and this browser may hold the only copy. Download them before you delete them.
                  </p>
                ) : null}
              </div>
              <div className="ask" style={{ marginTop: 10 }}>
                {review.copies.length ? <button className="btn ghost" disabled={busy} onClick={() => downloadSetAside(review.copies)}>Download the set-aside versions</button> : null}
                <button className="btn" disabled={busy} onClick={() => signOut('keep')}>Keep {several ? 'them' : 'it'} in this browser and sign out</button>
                <button className="btn ghost" disabled={busy} onClick={() => signOut('delete')}>Delete {several ? 'them' : 'it'} and sign out</button>
                <button className="btn ghost" disabled={busy} onClick={closeReview}>Cancel</button>
              </div>
              <p className="hint">If you keep {several ? 'them, they stay' : 'it, it stays'} in this browser linked to your account, and you see {several ? 'them' : 'it'} again when you sign in here. Other accounts and signed-out visitors do not see your Lab progress here, but anyone with access to this computer could read the browser’s storage.</p>
            </div>
          ) : null}
          {copies.length && !review ? (
            <div style={{ marginTop: 16 }}>
              <h2>Set-aside versions in this browser</h2>
              <p className="hint">Versions of your work set aside when you chose between two versions. They are not in your account. Download any you may need.</p>
              <SetAsideList copies={copies} onChange={() => setCopies(setAsideFor(user.id))} />
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
