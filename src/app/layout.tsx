import type { Metadata } from 'next';
import './globals.css';
import { Chef } from '@/components/Chef';
import { Spine } from '@/components/Spine';

export const metadata: Metadata = { title: 'Supervisor', description: 'Check your thesis against your university rules and get supervisor-style feedback.' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <Spine />
          <main className="page">{children}</main>
          <Chef />
        </div>
      </body>
    </html>
  );
}
