'use client';
import { useCallback, useEffect, useState } from 'react';
import { isLang, LANG_KEY, type Lang } from '@/lib/i18n';

/** The Lab language. Kept in this browser only, apart from the thesis, so changing it never touches thesis data. */
export function useLang(): [Lang, (l: Lang) => void] {
  const [lang, setLangState] = useState<Lang>('en');
  useEffect(() => {
    try {
      const v = localStorage.getItem(LANG_KEY);
      if (isLang(v)) setLangState(v);
    } catch {}
    const onStorage = (e: StorageEvent) => {
      if (e.key === LANG_KEY && isLang(e.newValue)) setLangState(e.newValue);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {}
  }, []);
  return [lang, setLang];
}
