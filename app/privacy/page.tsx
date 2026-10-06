import type { Metadata } from 'next';
import LegalPage from '@/components/LegalPage';
import { PRIVACY } from '@/lib/legal';

export const metadata: Metadata = { title: 'Privacy · Mise' };
export default function Privacy() { return <LegalPage title="Privacy Policy" sections={PRIVACY} />; }
