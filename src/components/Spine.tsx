'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

const LINKS = [
  ['/', 'My path'],
  ['/check', 'Check'],
  ['/feedback', 'Feedback'],
  ['/guides', 'Guides'],
  ['/account', 'Account'],
];

export function Spine() {
  const path = usePathname();
  useEffect(() => {
    try {
      const d = localStorage.getItem('degree');
      if (d) document.documentElement.dataset.degree = d;
    } catch {}
  }, []);
  return (
    <aside className="spine">
      <Link href="/" className="spine-title">Supervisor</Link>
      <nav aria-label="Main">
        {LINKS.map(([href, label]) => (
          <Link key={href} href={href} aria-current={path === href ? 'page' : undefined}>{label}</Link>
        ))}
      </nav>
    </aside>
  );
}
