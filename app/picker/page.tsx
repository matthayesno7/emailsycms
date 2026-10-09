import type { Metadata } from 'next';
import Picker from '@/components/Picker';
import { loadPicker, PICK_KINDS } from '@/lib/integrations';

// The Mise picker, for other tools to embed (iframe) or open (pop-up): /picker?key=mpk_…[&multiple=1][&types=image,logo,product]
// Only the key's allowed sites may frame it (the middleware sets frame-ancestors), and it only sends
// what's picked to those sites. Opened on its own, it's a test page that shows what a tool would get.
export const metadata: Metadata = { title: 'Pick from Mise', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function PickerPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (v: unknown) => (Array.isArray(v) ? v[0] : v) as string | undefined;
  const key = one(sp.key) || '';
  const ctx = await loadPicker(key);
  if ('error' in ctx) {
    return (
      <main className="pk-shell pk-off">
        <span className="wordmark">Mise<i aria-hidden /></span>
        <h1>{ctx.error === 'plan' ? 'This picker is switched off' : 'This picker link isn’t working'}</h1>
        <p>{ctx.error === 'plan'
          ? 'The brand isn’t on Pro or Enterprise any more. An owner can upgrade it in Mise › Settings › Plan & usage.'
          : 'The key is missing, mistyped or has been turned off. An admin can create a new one in Mise › Settings › Integrations.'}</p>
      </main>
    );
  }
  const types = (one(sp.types) || 'image,logo,product').split(',').filter((t) => (PICK_KINDS as readonly string[]).includes(t));
  return <Picker pickerKey={key} brand={ctx.ws.name} sites={ctx.key.origins} multiple={['1', 'true'].includes(one(sp.multiple) || '')} types={types.length ? types : ['image', 'logo', 'product']} />;
}
