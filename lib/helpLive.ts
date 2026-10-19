// The help centre as it's shown: lib/helpArticles.ts (generated) minus articles for features
// that are switched off (lib/features.ts). Import from here, not from helpArticles, in the app.
import { HELP_ARTICLES as ALL, HELP_CATEGORIES as CATS, HELP_INTRO, HELP_ORIGIN, type HelpArticle } from '@/lib/helpArticles';
import { CREATE_ON } from '@/lib/features';

const off = (category: string) => !CREATE_ON && category === 'Create';

export const HELP_ARTICLES: HelpArticle[] = ALL.filter((a) => !off(a.category));
export const HELP_CATEGORIES: string[] = CATS.filter((c) => !off(c));
export const helpArticle = (slug: string) => HELP_ARTICLES.find((a) => a.slug === slug) || null;
export { HELP_INTRO, HELP_ORIGIN, type HelpArticle };
