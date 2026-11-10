'use client';
import { AI_PER_DAY, AI_PER_MINUTE } from '@/lib/aiLimit';

/** Phase P4: an AI failure, in plain words, with "Try again" when trying again may work. */
export function AiErrorNote({ message, retryable, onRetry, busy }: { message: string; retryable?: boolean; onRetry?: () => void; busy?: boolean }) {
  if (!message) return null;
  return (
    <div className="error" role="alert">
      <p>{message}</p>
      {retryable && onRetry ? (
        <p style={{ marginTop: 6 }}>
          <button type="button" className="btn ghost" disabled={busy} onClick={onRetry}>{busy ? 'Trying again…' : 'Try again'}</button>
        </p>
      ) : null}
    </div>
  );
}

/**
 * The site's free AI limits. The counts live in server memory, so Supervisor cannot say exactly how many
 * requests remain: this states the limits, not a remaining number.
 */
export function AiLimitsNote({ ownKey }: { ownKey?: boolean }) {
  return (
    <p className="hint">
      {ownKey
        ? 'You use your own AI key, so your provider’s limits apply.'
        : `Free AI: up to ${AI_PER_MINUTE} requests a minute and ${AI_PER_DAY} a day per account. Supervisor cannot show exactly how many remain. The daily limit resets at midnight UTC. With your own key in Account, your provider’s limits apply instead.`}
    </p>
  );
}
