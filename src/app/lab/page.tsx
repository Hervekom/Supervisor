import type { Metadata } from 'next';
import { Lab } from '@/components/Lab';
import { loadCatalogue } from '@/lib/softwareCatalog';

export const metadata: Metadata = { title: 'Lab · Supervisor' };

export default function LabPage() {
  return <Lab catalogue={loadCatalogue()} />;
}
