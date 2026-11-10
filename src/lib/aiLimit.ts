import { AiError } from './llm';

export const AI_PER_MINUTE = 10;
export const AI_PER_DAY = 80;

type Use = { minute: number; minuteCount: number; day: number; dayCount: number };
const uses = new Map<string, Use>();

/**
 * Shares the site's free AI quota fairly. It applies only to the site's key.
 * Counts live in server memory, so a restart resets them and separate server copies count separately.
 */
export function limitSiteAi(userId: string | undefined, usesOwnKey: boolean, now = Date.now()) {
  if (!userId || usesOwnKey) return;
  const minute = Math.floor(now / 60_000);
  const day = Math.floor(now / 86_400_000);
  const u = uses.get(userId) ?? { minute, minuteCount: 0, day, dayCount: 0 };
  if (u.minute !== minute) Object.assign(u, { minute, minuteCount: 0 });
  if (u.day !== day) Object.assign(u, { day, dayCount: 0 });
  if (u.dayCount >= AI_PER_DAY) throw new AiError('site_daily_limit', false, false, 429);
  if (u.minuteCount >= AI_PER_MINUTE) throw new AiError('site_minute_limit', true, false, 429, Math.max(1, Math.ceil(((minute + 1) * 60_000 - now) / 1000)));
  u.minuteCount++;
  u.dayCount++;
  uses.set(userId, u);
}
