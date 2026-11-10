'use client';
import { useCallback, useEffect, useState } from 'react';
import type { DegreeType, Profile } from '@/lib/types';

const get = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
export const put = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
    return true;
  } catch {
    return false;
  }
};

export function useProfiles() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileId, setProfileId] = useState('');
  const [degree, setDegreeState] = useState<DegreeType | ''>('');
  const [loadError, setLoadError] = useState('');

  const setDegree = useCallback((d: DegreeType) => {
    setDegreeState(d);
    put('degree', d);
  }, []);

  const reload = useCallback(async () => {
    setLoadError('');
    try {
      const r = await fetch('/api/profiles');
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setProfiles(j.profiles);
      const saved = get('profile');
      const p: Profile | undefined = j.profiles.find((x: Profile) => x.profile_id === saved) ?? j.profiles[0];
      if (p) {
        setProfileId(p.profile_id);
        const d = get('degree') as DegreeType | null;
        setDegree(d && p.scope.degree_types.includes(d) ? d : p.scope.degree_types[0]);
      }
    } catch {
      setLoadError('University profiles could not load. Refresh the page.');
    }
  }, [setDegree]);

  useEffect(() => { reload(); }, [reload]);

  const choose = (id: string) => {
    setProfileId(id);
    put('profile', id);
    const p = profiles.find((x) => x.profile_id === id);
    if (p && degree && !p.scope.degree_types.includes(degree)) setDegree(p.scope.degree_types[0]);
  };
  return { profiles, profile: profiles.find((p) => p.profile_id === profileId) ?? null, profileId, choose, degree, setDegree, reload, loadError };
}
