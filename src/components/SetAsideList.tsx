'use client';
import { useState } from 'react';
import { exportSetAside, removeSetAside, type SetAside } from '@/lib/pathSync';

/** Saves set-aside versions to a file the student keeps. */
export function downloadSetAside(copies: SetAside[], name = 'supervisor-set-aside-versions') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([exportSetAside(copies)], { type: 'application/json' }));
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

const describe = (c: SetAside) => {
  const runs = c.path.runs?.length ?? 0;
  const steps = Object.keys(c.path.steps ?? {}).length;
  return `${c.at ? c.at.slice(0, 16).replace('T', ' ') : 'Earlier version'} · ${c.path.title || c.path.topic || 'Untitled'} · ${steps} step${steps === 1 ? '' : 's'}, ${runs} run${runs === 1 ? '' : 's'}`;
};

/** The set-aside versions this account can see, with download and an explicit, confirmed removal. */
export function SetAsideList({ copies, onChange }: { copies: SetAside[]; onChange: () => void }) {
  const [confirm, setConfirm] = useState<number | null>(null);
  if (!copies.length) return null;
  return (
    <div className="set-aside">
      <ul className="todo">
        {copies.map((c, i) => (
          <li key={`${c.at}-${i}`}>
            <span>{describe(c)}</span>
            <div className="ask" style={{ marginTop: 6 }}>
              <button type="button" className="btn ghost" onClick={() => downloadSetAside([c], `supervisor-set-aside-version-${i + 1}`)}>Download</button>
              {confirm === i ? (
                <>
                  <button type="button" className="btn danger" onClick={() => { removeSetAside(c); setConfirm(null); onChange(); }}>Remove this version</button>
                  <button type="button" className="btn ghost" onClick={() => setConfirm(null)}>Keep it</button>
                </>
              ) : (
                <button type="button" className="btn ghost" onClick={() => setConfirm(i)}>Remove</button>
              )}
            </div>
            {confirm === i ? <p className="hint">This browser may hold the only copy. Download it first if you might need it.</p> : null}
          </li>
        ))}
      </ul>
      <button type="button" className="btn ghost" onClick={() => downloadSetAside(copies)}>Download all {copies.length}</button>
    </div>
  );
}
