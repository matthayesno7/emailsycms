// A small Markdown renderer for the help centre (headings, paragraphs, lists, tables, code,
// bold, links). The content is Mise's own, so this returns an HTML string. Safe in the browser too.

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const slugify = (t: string) => t.toLowerCase().replace(/<[^>]+>/g, '').replace(/[’'"“”*`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Links between articles are written as "slug" or "slug#anchor"; base is where articles live (/help).
function href(u: string, base: string) {
  if (/^(https?:|mailto:|\/|#)/.test(u)) return u;
  return `${base}/${u}`;
}

function fmt(t: string, base: string) {
  return t
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text, url) => {
      const h = href(url.replace(/&amp;/g, '&'), base);
      const ext = /^https?:/.test(h);
      return `<a href="${esc(h)}"${ext ? ' target="_blank" rel="noreferrer"' : ''}>${text}</a>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');
}

export function inline(t: string, base = '/help') {
  return t.split(/(`[^`]+`)/).map((p) => (p.length > 1 && p.startsWith('`') && p.endsWith('`') ? `<code>${esc(p.slice(1, -1))}</code>` : fmt(esc(p), base))).join('');
}

type Item = { indent: number; ordered: boolean; text: string };
const LIST = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

function listHtml(items: Item[], base: string): string {
  let i = 0;
  const build = (indent: number): string => {
    const ordered = items[i].ordered;
    let out = ordered ? '<ol>' : '<ul>';
    while (i < items.length && items[i].indent >= indent) {
      if (items[i].indent > indent) { out = out.replace(/<\/li>$/, '') + build(items[i].indent) + '</li>'; continue; }
      out += `<li>${inline(items[i].text, base)}</li>`;
      i++;
    }
    return out + (ordered ? '</ol>' : '</ul>');
  };
  let html = '';
  while (i < items.length) html += build(items[i].indent);
  return html;
}

export function markdown(src: string, base = '/help') {
  const lines = src.replace(/\r/g, '').split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    // code block
    if (/^```/.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }
    // heading
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = Math.max(2, h[1].length);
      out.push(`<h${level} id="${slugify(h[2])}">${inline(h[2], base)}</h${level}>`);
      i++;
      continue;
    }
    // horizontal rule
    if (/^---+\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    // table
    if (line.trim().startsWith('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const cells = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]));
      out.push(`<div class="hc-table"><table><thead><tr>${head.map((c) => `<th>${inline(c, base)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c, base)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    // list (with nested items and indented continuation lines)
    if (LIST.test(line)) {
      const items: Item[] = [];
      while (i < lines.length) {
        const m = lines[i].match(LIST);
        if (m) { items.push({ indent: m[1].length, ordered: /\d/.test(m[2]), text: m[3] }); i++; continue; }
        if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) { items[items.length - 1].text += '<br>' + lines[i].trim(); i++; continue; }
        break;
      }
      // continuation lines were added raw; inline() escapes them, so keep the break as a marker
      out.push(listHtml(items.map((it) => ({ ...it, text: it.text })), base).replace(/&lt;br&gt;/g, '<br>'));
      continue;
    }
    // paragraph: consecutive plain lines, each on its own line
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !LIST.test(lines[i]) && !/^(#{1,4}\s|```|\|)/.test(lines[i].trim())) para.push(lines[i++].trim());
    out.push(`<p>${para.map((p) => inline(p, base)).join('<br>')}</p>`);
  }
  return out.join('\n');
}
