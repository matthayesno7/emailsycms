// The help centre as it's shown: lib/helpArticles.ts (generated) minus articles for features
// that are switched off (lib/features.ts). Import from here, not from helpArticles, in the app.
import { HELP_ARTICLES as ALL, HELP_CATEGORIES as CATS, HELP_INTRO as INTRO, HELP_ORIGIN, type HelpArticle } from '@/lib/helpArticles';
import { CREATE_ON } from '@/lib/features';

const off = (category: string) => !CREATE_ON && category === 'Create';

// Inside articles, [[create]]…[[/create]] shows only while Create is on and
// [[nocreate]]…[[/nocreate]] only while it's off. The markers never reach the page.
const keep = CREATE_ON ? 'create' : 'nocreate', drop = CREATE_ON ? 'nocreate' : 'create';
const live = (t: string) => t
  .replace(new RegExp(`\\[\\[${drop}\\]\\][\\s\\S]*?\\[\\[/${drop}\\]\\]`, 'g'), '')
  .replace(new RegExp(`\\[\\[/?${keep}\\]\\]`, 'g'), '')
  .replace(/\n{3,}/g, '\n\n');

export const HELP_ARTICLES: HelpArticle[] = ALL.filter((a) => !off(a.category)).map((a) => ({ ...a, description: live(a.description), body: live(a.body) }));
export const HELP_CATEGORIES: string[] = CATS.filter((c) => !off(c));
export const helpArticle = (slug: string) => HELP_ARTICLES.find((a) => a.slug === slug) || null;
export const HELP_INTRO = live(INTRO);
export { HELP_ORIGIN, type HelpArticle };
