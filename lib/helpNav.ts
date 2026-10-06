import { HELP_ARTICLES, HELP_CATEGORIES, type HelpArticle } from '@/lib/helpArticles';
import { slugify } from '@/lib/markdown';

// Shorter names for the help centre sidebar, where full titles would wrap.
const SHORT: Record<string, string> = {
  'what-is-mise': 'What Mise is',
  'quick-start': 'Set up in 10 minutes',
  'brands': 'Brands',
  'importing-from-cloud': 'Importing from the cloud',
  'products': 'Products',
  'auto-organise': 'How files are organised',
  'asset-page': 'The asset page',
  'editing': 'Editing',
  'availability': 'No longer available',
  'review': 'Review',
  'brand-kit': 'Brand kit',
  'create-in-claude': 'Make things in Claude',
  'what-recipients-see': 'What recipients see',
  'claude-tools': 'What Claude can do',
  'figma': 'Figma',
  'team-and-roles': 'Team and roles',
  'plans': 'Plans',
  'billing': 'Billing',
  'limits': 'Limits',
  'troubleshooting': 'Troubleshooting',
  'faq': 'FAQ',
  'privacy-security': 'Privacy and security',
};

export const navLabel = (a: HelpArticle) => SHORT[a.slug] || a.title;

export const HELP_NAV = HELP_CATEGORIES.map((c) => ({
  category: c,
  items: HELP_ARTICLES.filter((a) => a.category === c).map((a) => ({ slug: a.slug, label: navLabel(a) })),
}));

// The article's ## headings, for "On this page". Ids match the renderer's.
export function headings(body: string) {
  let code = false;
  const out: { id: string; text: string }[] = [];
  for (const line of body.split('\n')) {
    if (/^\s*```/.test(line)) code = !code;
    const m = !code && line.match(/^##\s+(.+?)\s*#*$/);
    if (m) out.push({ id: slugify(m[1]), text: m[1].replace(/\*\*|`/g, '') });
  }
  return out;
}
