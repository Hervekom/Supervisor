'use client';
import { useEffect, type RefObject } from 'react';

/**
 * While a dialog is open: focus moves to its first control, Tab and Shift+Tab stay inside it,
 * and Escape closes it. When it closes, focus returns to the control that opened it.
 */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, open: boolean, onEscape: () => void, returnTo: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const box = ref.current;
    if (!box) return;
    const items = () => [...box.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')];
    items()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onEscape();
        return;
      }
      if (e.key !== 'Tab') return;
      const list = items();
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!box.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const back = returnTo.current;
    return () => {
      document.removeEventListener('keydown', onKey);
      back?.focus();
    };
  }, [open, ref, onEscape, returnTo]);
}
