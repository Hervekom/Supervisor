'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  ['/', 'My path'],
  ['/check', 'Check'],
  ['/feedback', 'Feedback'],
  ['/guides', 'Guides'],
  ['/account', 'Account'],
];

export function Spine() {
  const path = usePathname();
  return (
    <header className="topbar">
      <Link href="/" className="brand"><span aria-hidden="true">SV</span>Supervisor</Link>
      <nav aria-label="Main">
        {LINKS.map(([href, label]) => (
          <Link key={href} href={href} aria-current={path === href ? 'page' : undefined}>{label}</Link>
        ))}
      </nav>
    </header>
  );
}
