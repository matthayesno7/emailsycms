import type { Metadata } from 'next';
import LegalPage from '@/components/LegalPage';
import { DPA } from '@/lib/legal';

export const metadata: Metadata = {
  title: 'Data Processing Agreement · Mise',
  description: 'Mise’s standard Data Processing Agreement under UK GDPR Article 28.',
  alternates: { canonical: 'https://app.misedam.com/dpa' },
};
export default function Dpa() {
  return <LegalPage title="Data Processing Agreement" sections={DPA} />;
}
