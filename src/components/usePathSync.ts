'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { emptyPath, type PathState } from '@/lib/path';
import { isDirty, keepAccount, keepLocal, pushNow, readLocalPath, readSync, setAside, syncNow, writeLocalPath, type SyncOutcome } from '@/lib/pathSync';
import { cloudPaths } from '@/lib/supabase';

export type SaveStatus = 'idle' | 'waiting' | 'saving' | 'saved' | 'unconfirmed' | 'conflict';
export type Conflict = { cloud: PathState | null; version: string | null };

const SAVE_DELAY = 1200;
const RETRY_DELAY = 15_000;

export function usePathSync(opts: { userId?: string; loaded: boolean; path: PathState; replace: (p: PathState) => void }) {
  const { userId, loaded, path, replace } = opts;
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [resolving, setResolving] = useState(false);
  const running = useRef(false);
  const again = useRef(false);
  const blocked = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const retry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const idRef = useRef(userId);
  idRef.current = userId;

  const dirty = () => !!idRef.current && isDirty(readLocalPath(), readSync(), idRef.current);

  const apply = useCallback((r: SyncOutcome) => {
    if (r.state === 'conflict') {
      blocked.current = true;
      setConflict({ cloud: r.cloud, version: r.version });
      setStatus('conflict');
      return;
    }
    blocked.current = false;
    setConflict(null);
    if (r.state === 'adopted') replace(r.path);
    setSavedAt(new Date());
    setStatus('saved');
  }, [replace]);

  const run = useCallback(async (full: boolean) => {
    const id = idRef.current;
    if (!id || blocked.current) return;
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    clearTimeout(retry.current);
    setStatus('saving');
    let failed = false;
    try {
      apply(await (full ? syncNow(id, cloudPaths) : pushNow(id, cloudPaths)));
    } catch {
      failed = true;
      setStatus('unconfirmed');
      retry.current = setTimeout(() => run(true), RETRY_DELAY);
    } finally {
      running.current = false;
      const queued = again.current;
      again.current = false;
      // A failed save waits for the retry, so an outage cannot cause a request loop.
      if (!failed && !blocked.current && (queued || dirty()) && dirty()) run(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apply]);

  // On arrival and after sign-in, compare this browser with the account.
  useEffect(() => {
    if (!loaded || !userId) return;
    blocked.current = false;
    run(true);
  }, [loaded, userId, run]);

  // Each edit is saved shortly after the student pauses.
  useEffect(() => {
    if (!loaded || !userId || blocked.current || !dirty()) return;
    setStatus('waiting');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => run(false), SAVE_DELAY);
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, loaded, userId]);

  // Leaving must not cancel a save. Anything still pending is retried on the next visit.
  useEffect(() => {
    const flush = () => {
      if (dirty()) run(false);
    };
    const hidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    const online = () => run(true);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('online', online);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('online', online);
      clearTimeout(retry.current);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  async function chooseThisBrowser() {
    if (!userId || !conflict) return;
    setResolving(true);
    try {
      blocked.current = false;
      apply(await keepLocal(userId, cloudPaths, conflict.cloud, conflict.version));
    } catch {
      blocked.current = true;
      setStatus('conflict');
    } finally {
      setResolving(false);
    }
  }

  /** Keeps the runs of both versions. Both original versions are set aside first, so nothing is lost. */
  async function chooseCombined(merged: PathState) {
    if (!userId || !conflict) return;
    setResolving(true);
    try {
      setAside(readLocalPath());
      writeLocalPath(merged);
      replace(merged);
      blocked.current = false;
      apply(await keepLocal(userId, cloudPaths, conflict.cloud, conflict.version));
    } catch {
      blocked.current = true;
      setStatus('conflict');
    } finally {
      setResolving(false);
    }
  }

  function chooseAccount() {
    if (!userId || !conflict) return;
    replace(keepAccount(userId, conflict.cloud, conflict.version, emptyPath()));
    blocked.current = false;
    setConflict(null);
    setStatus('saved');
    setSavedAt(new Date());
  }

  return { status, savedAt, conflict, resolving, chooseThisBrowser, chooseAccount, chooseCombined };
}
