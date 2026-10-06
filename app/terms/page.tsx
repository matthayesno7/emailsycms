import type { Metadata } from 'next';
import LegalPage from '@/components/LegalPage';
import { TERMS } from '@/lib/legal';

export const metadata: Metadata = { title: 'Terms · Mise', alternates: { canonical: 'https://misedam.com/terms' } };
export default function Terms() { return <LegalPage title="Terms of Service" sections={TERMS} />; }
