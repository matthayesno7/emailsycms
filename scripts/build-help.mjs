// Regenerates lib/helpArticles.ts from the help centre's Markdown (content/help/*.md).
//   node scripts/build-help.mjs
// The order and categories come from content/help/_index.md.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.cwd(), 'content', 'help');
const idx = readFileSync(join(dir, '_index.md'), 'utf8');
const order = [...idx.matchAll(/\]\(([a-z-]+)\)/g)].map((m) => m[1]);
const cats = [];
const arts = order.map((slug) => {
  const s = readFileSync(join(dir, `${slug}.md`), 'utf8');
  const m = s.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const meta = {};
  for (const line of m[1].split('\n')) {
    const k = line.slice(0, line.indexOf(':')).trim();
    let v = line.slice(line.indexOf(':') + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    meta[k] = v;
  }
  if (!cats.includes(meta.category)) cats.push(meta.category);
  return { slug, title: meta.title, description: meta.description, category: meta.category, body: m[2].trim().replace(/^# .*\n+/, '') };
});
const intro = idx.match(/^# Mise help centre\n\n([\s\S]*?)\n\n## /m)[1].trim();
let ts = "// Generated from the help centre's Markdown articles (content/help). Edit the .md files, then run\n// `node scripts/build-help.mjs` to regenerate this file.\n";
ts += 'export type HelpArticle = { slug: string; title: string; description: string; category: string; body: string };\n';
ts += `export const HELP_INTRO = ${JSON.stringify(intro)};\n`;
ts += `export const HELP_CATEGORIES: string[] = ${JSON.stringify(cats)};\n`;
ts += `export const HELP_ARTICLES: HelpArticle[] = ${JSON.stringify(arts, null, 1)};\n`;
ts += 'export const helpArticle = (slug: string) => HELP_ARTICLES.find((a) => a.slug === slug) || null;\n';
writeFileSync(join(process.cwd(), 'lib', 'helpArticles.ts'), ts);
console.log(`${arts.length} articles → lib/helpArticles.ts`);
