'use client';
import { useState } from 'react';
import type { Messages } from '@/lib/i18n';

export function CopyCommand({ command, m }: { command: string; m: Messages }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setState('copied');
    } catch {
      setState('failed');
    }
    setTimeout(() => setState('idle'), 2500);
  }
  return (
    <div className="cmd">
      <code>{command}</code>
      <button type="button" className="btn ghost" onClick={copy} aria-label={m.copyAria(command)}>{state === 'copied' ? m.copied : m.copy}</button>
      {state === 'failed' ? <span className="hint" role="status">{m.copyFailed}</span> : null}
    </div>
  );
}
