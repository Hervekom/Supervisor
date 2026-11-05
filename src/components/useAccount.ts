'use client';
import type { User } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export const RESET_PATH = '/account/reset';

export function useAccount() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // A recovery link can land on any page. The update page is the only place that handles it.
    const { pathname, hash } = window.location;
    if (pathname !== RESET_PATH && /type=recovery|error_code=otp_expired/.test(hash)) {
      window.location.replace(`${RESET_PATH}${hash}`);
      return;
    }
    const db = supabase();
    if (!db) {
      setReady(true);
      return;
    }
    db.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setReady(true);
    });
    const { data } = db.auth.onAuthStateChange((_, s) => setUser(s?.user ?? null));
    return () => data.subscription.unsubscribe();
  }, []);
  return { user, ready };
}
