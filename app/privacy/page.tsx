import type { Metadata } from 'next';
import LegalPage from '@/components/LegalPage';
import { PRIVACY } from '@/lib/legal';

export const metadata: Metadata = { title: 'Privacy · Mise', alternates: { canonical: 'https://misedam.com/privacy' } };
export default function Privacy() { return <LegalPage title="Privacy Policy" sections={PRIVACY} />; }
