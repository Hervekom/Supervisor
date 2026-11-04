import { MESSAGES } from './messages';

type AuthFailure = { code?: string; name?: string; status?: number; message?: string };

const isNetwork = (e: AuthFailure) => e.name === 'AuthRetryableFetchError' || e.status === 0 || /fetch|network/i.test(e.message ?? '');

/** Turns an Auth error into plain words. Anything unknown stays private. */
export function authMessage(e: AuthFailure, kind: 'sign_in' | 'sign_up' | 'update') {
  if (isNetwork(e)) return MESSAGES.network;
  if (e.status === 429 || e.code === 'over_email_send_rate_limit' || e.code === 'over_request_rate_limit') return 'Too many attempts. Please wait a few minutes, then try again.';
  if (e.code === 'email_not_confirmed') return 'Please confirm your email first. Open the link we sent you, then sign in.';
  if (e.code === 'weak_password') return 'Choose a stronger password, with at least 8 characters.';
  if (e.code === 'same_password') return 'Your new password must be different from your old one.';
  if (kind === 'sign_in') return 'Your email or password is not correct. Check them, or reset your password.';
  if (kind === 'update') return "We couldn't update your password. Please request a new reset link.";
  return "We couldn't create your account. Check your email address and password, then try again.";
}

export function isNetworkFailure(e: AuthFailure) {
  return isNetwork(e);
}
