'use client';
import { useCallback, useEffect, useState } from 'react';
import { listDocs, type SourceDoc } from '@/lib/docStore';
import { useAccount } from './useAccount';

/** Phase P7: this browser's research documents for the person using it ("guest" before signing in). */
export function useSourceDocs() {
  const { user, ready } = useAccount();
  const owner = ready ? (user?.id ?? 'guest') : null;
  const [docs, setDocs] = useState<SourceDoc[]>([]);
  const [guestDocs, setGuestDocs] = useState<SourceDoc[]>([]);
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(async () => {
    if (!owner) return;
    const all = await listDocs();
    setDocs(all.filter((d) => d.owner === owner));
    setGuestDocs(owner === 'guest' ? [] : all.filter((d) => d.owner === 'guest'));
    setLoaded(true);
  }, [owner]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { owner, docs, guestDocs, loaded, reload, signedIn: !!user };
}
