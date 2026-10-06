import type { Metadata } from 'next';
import LegalPage from '@/components/LegalPage';
import { SECURITY } from '@/lib/legal';

export const metadata: Metadata = {
  title: 'Security · Mise',
  description: 'How Mise protects your brand’s files and data: EU hosting, encryption, isolation between customers, access controls, AI and subprocessors.',
  alternates: { canonical: 'https://app.misedam.com/security' },
};
export default function Security() {
  return <LegalPage title="Security" intro="for security reviews and procurement" sections={SECURITY} />;
}
