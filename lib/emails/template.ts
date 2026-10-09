// A plain, personal email: a note from Matt, not a newsletter. White, dark-brown text, Mise-orange links,
// system fonts, 600px, no images (the "Mise." wordmark is text). Renders HTML and plain text from the same content.

export type Step = { title: string; body: string; link?: { label: string; url: string } };
export type Email = {
  subject: string;
  preheader: string;
  greeting: string;            // "Hi Sam," or "Hi there,"
  intro: string[];             // paragraphs before the steps
  steps: Step[];               // numbered
  outro: string[];             // paragraphs after the steps
};

const INK = '#2A1A14', ORANGE = '#C4501E', MUTED = '#6E5A4E';
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const p = (html: string, extra = '') => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${INK};${extra}">${html}</p>`;
const a = (label: string, url: string) => `<a href="${esc(url)}" style="color:${ORANGE};text-decoration:underline;font-weight:600">${esc(label)}</a>`;

const SIGN_OFF = { name: 'Matt', role: 'Co-founder, Mise', site: 'https://misedam.com', siteLabel: 'misedam.com' };

export function renderHtml(e: Email) {
  const steps = e.steps.map((s, i) => `
    <tr><td style="padding:0 0 22px">
      ${p(`<strong>${i + 1}. ${esc(s.title)}</strong>`, 'margin-bottom:6px')}
      ${p(esc(s.body), s.link ? 'margin-bottom:6px' : 'margin-bottom:0')}
      ${s.link ? p(`&rarr; ${a(s.link.label, s.link.url)}`, 'margin-bottom:0') : ''}
    </td></tr>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(e.subject)}</title></head>
<body style="margin:0;padding:0;background:#ffffff">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#ffffff;font-size:1px;line-height:1px">${esc(e.preheader)}${'&#8203;&zwnj;&nbsp;'.repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff">
  <tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;font-family:${FONT}">
      <tr><td style="padding:0 0 28px;font-family:${FONT};font-size:22px;font-weight:700;letter-spacing:-0.02em;color:${INK}">Mise<span style="color:${ORANGE}">.</span></td></tr>
      <tr><td style="font-family:${FONT}">
        ${p(esc(e.greeting))}
        ${e.intro.map((t) => p(esc(t))).join('')}
      </td></tr>
      ${steps}
      <tr><td style="font-family:${FONT}">
        ${e.outro.map((t) => p(esc(t))).join('')}
        ${p(`${SIGN_OFF.name}<br><span style="color:${MUTED}">${SIGN_OFF.role}</span><br>${a(SIGN_OFF.siteLabel, SIGN_OFF.site)}`, 'margin-top:24px')}
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

export function renderText(e: Email) {
  const steps = e.steps.map((s, i) => [`${i + 1}. ${s.title}`, s.body, ...(s.link ? [`→ ${s.link.label}: ${s.link.url}`] : [])].join('\n')).join('\n\n');
  return [e.greeting, ...e.intro, ...(steps ? [steps] : []), ...e.outro, `${SIGN_OFF.name}\n${SIGN_OFF.role}\n${SIGN_OFF.siteLabel}`].join('\n\n');
}
