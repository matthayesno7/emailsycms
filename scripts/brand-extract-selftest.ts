// Self-test for the website brand extractor on a small fixture page.
// Run: npx tsc scripts/brand-extract-selftest.ts --outDir /tmp/st --module commonjs --target es2022 --skipLibCheck && node /tmp/st/scripts/brand-extract-selftest.js
import { combine, heuristicKit, parseCss, parseHtml } from '../lib/brandExtract';
import { missing, warnings } from '../lib/brandKit';

const html = `<!doctype html><html><head><title>Oakhaus | Knitwear made in Britain</title>
<meta property="og:site_name" content="Oakhaus"><meta name="theme-color" content="#1F3A2E">
<meta property="og:image" content="/media/share.jpg">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/css/site.css"><link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600&family=Inter:wght@400;600" rel="stylesheet">
<style>:root{--brand-green:#1f3a2e;--brand-cream:#f6f1e7;--text:#222}</style></head>
<body><header><a href="/" class="site-logo"><img src="/img/oakhaus-logo.svg" alt="Oakhaus"></a>
<button class="icon-search"><svg class="icon-search" viewBox="0 0 10 10"><path d="M0 0h10v10H0z"/></svg></button></header>
<main><a class="btn btn-primary" href="/shop">Shop knitwear</a></main>
<footer><img src="/img/visa.svg" alt="Visa" class="payment-icon"></footer></body></html>`;

const css = `
body{color:var(--text);background-color:var(--brand-cream);font-family:Inter,Arial,sans-serif;font-size:16px}
h1,h2{font-family:"Cormorant Garamond",Georgia,serif;font-weight:600;text-transform:uppercase}
h1{font-size:44px}
a{color:#1f3a2e}
.btn-primary{background-color:var(--brand-green);color:#fff;border-radius:2px;padding:14px 32px;font-weight:600;text-transform:uppercase}
.btn-primary:hover{background-color:#000}
.cookie-banner{background:#ffffff}
@media (min-width: 800px){ .hero{background:#c9a86a} }
@font-face{font-family:"Oak Sans";src:url(/fonts/oak.woff2) format("woff2")}
`;

const h = parseHtml(html, 'https://oakhaus.example/');
const c = parseCss(h.inlineCss + css, 'https://oakhaus.example/');
const s = combine('https://oakhaus.example/', h, c);
console.log('name', s.site_name, '|', s.title);
console.log('theme', s.theme_color, 'og', s.og_image);
console.log('logos', s.logos.map((l) => `${l.url || 'svg'} (${l.score})`).join(', '));
console.log('sheets', s.stylesheets.join(','), 'fonts', s.google_fonts.length);
console.log('vars', JSON.stringify(s.css_vars));
console.log('body', JSON.stringify(s.body));
console.log('head', JSON.stringify(s.headings));
console.log('buttons', JSON.stringify(s.buttons));
console.log('faces', JSON.stringify(s.font_faces));
console.log('top colours', s.colour_counts.slice(0, 5).map(([k, n]) => `${k}:${n}`).join(' '));
const k = heuristicKit(s, 'Oakhaus');
console.log('kit colours', JSON.stringify(k.colors));
console.log('kit type', JSON.stringify(k.type));
console.log('kit button', JSON.stringify(k.button));
console.log('missing', missing(k).join(', '), '| warnings', warnings(k).join(' / '));
