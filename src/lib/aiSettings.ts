import type { AiChoice } from './providers';

const KEY = 'ai:v1';

export function loadAi(): AiChoice | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return v && v.apiKey && v.model ? (v as AiChoice) : null;
  } catch {
    return null;
  }
}

export function saveAi(v: AiChoice) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
}

export function clearAi() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}
