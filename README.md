# Mise

_Formerly Emailsy. The repo, database and connector paths keep the old internal names._

The brand asset library marketing teams actually want to use: images, logos, products, videos and email blocks in one place, sent where they're needed, and new on-brand work made from them with Claude.

- **Library:** upload images and logos, import a product feed (CSV), rename and move assets between categories.
- **Email-ready images:** crop to email sizes, remove white backgrounds, then drag straight into Figma.
- **Blocks:** Hero, Card, Product, Button and Footer content with copy and email-ready images, made in one click from any image or product.
- **Claude connector (MCP):** Claude can find assets, push full-size images into Figma, and turn blocks into components in any Figma design system.
- **Brand kit:** one per workspace (colours by role, fonts with email-safe fallbacks, buttons, logos, imagery style, voice). Built for you from the brand's website, or by Claude from a Figma email design system; reviewed against a live email preview, then approved.
- **Where assets come from:** every asset is *uploaded*, *from the product feed* or *generated* by AI. Generated assets arrive as drafts with their prompt, model and source product, and a person approves them.
- **Teams:** brand workspaces, invites and owner/editor roles.

Stack: Next.js 15 (App Router) · Supabase (Postgres, Auth, Storage) · Railway.

---

## 1. Supabase

1. Create a project at supabase.com.
2. Run the migration. Either:
   - **CLI:** `supabase link --project-ref <ref>` then `supabase db push`, or
   - **Dashboard:** SQL Editor → paste `supabase/migrations/20260923000000_init.sql` → Run.

   This creates the tables, row level security, the private `assets` storage bucket and realtime.
   Run the later migrations in `supabase/migrations/` in date order too (the dashboard route needs each one pasted and run; `db push` does it for you).
3. Authentication → URL Configuration:
   - **Site URL:** your app URL (e.g. `https://emailsy-cms.up.railway.app`)
   - **Redirect URLs:** add `https://<your-app>/auth/callback`, `https://<your-app>/login`, and `http://localhost:3000/**` for local work.
4. Authentication → Emails: the default mailer is fine for testing. For real users, add SMTP (Resend, Postmark…), since Supabase's built-in mailer is rate-limited.

## 2. Local

```bash
cp .env.example .env.local   # fill in the four values
npm install
npm run dev                  # http://localhost:3000
```

| Variable | Where from |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API (anon / publishable key) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API (service_role / secret key). Server only. |
| `NEXT_PUBLIC_APP_URL` | The public URL of the app, no trailing slash |
| `ANTHROPIC_API_KEY` | Optional. Turns on AI alt text, and lets Claude assign roles when building a brand kit from a website (without it a simpler heuristic does it). Server only. |
| `ANTHROPIC_MODEL` | Optional. Defaults to `claude-sonnet-5-5`. |

Check the MCP handler without a database: `npx tsx scripts/mcp-selftest.ts`. Check the website brand extractor on a fixture page: `npx tsx scripts/brand-extract-selftest.ts`.

## 3. GitHub → Railway

```bash
git init && git add -A && git commit -m "Mise: first version"
gh repo create emailsy-cms --private --source=. --push   # or create the repo on github.com and push
```

In Railway: New Project → Deploy from GitHub repo → pick `emailsy-cms`.
Add the four variables under Variables, then Settings → Networking → Generate Domain.
Set `NEXT_PUBLIC_APP_URL` to that domain and redeploy (it is baked in at build time).
`railway.json` sets the build and start commands and the `/api/health` health check.

## 4. Connect Claude

1. Sign in to Mise → **Claude connector** → **Create my connector link**.
2. In Claude: Settings → Connectors → **Add custom connector** → name it *Mise* → paste the link.
3. Also connect Figma's MCP. Then try: *"Put the Autumn hero image from Mise onto my selected Figma frame"* or use a block's **Copy request for Claude**.

The link contains a secret key. Anyone with it can read that user's workspaces, so treat it like a password; turn it off in the app if it leaks.


## 5. Import from Google Drive, Dropbox and Box (optional)

Each source appears in **Add → Import from Drive, Dropbox or Box** once its keys are set as Railway variables (no rebuild needed for these; they're read at runtime). Files are copied into Mise; re-importing the same file is skipped.

Run `supabase/migrations/20261001120000_connections.sql` first (Box keeps its sign-in there, readable only by the server).

**Dropbox** (pick files with the Dropbox Chooser):
1. dropbox.com/developers → Create app → Scoped access → Full Dropbox (the Chooser itself needs no scopes).
2. Settings → *Chooser / Saver / Embedder domains*: add your app's domain (e.g. `misedam-production.up.railway.app`).
3. Set `DROPBOX_APP_KEY`.

**Google Drive** (pick files with the Google Picker; access is limited to the files picked):
1. console.cloud.google.com → new project → enable **Google Drive API** and **Google Picker API**.
2. OAuth consent screen: External, add the scope `.../auth/drive.file` (non-sensitive, so no Google review needed).
3. Credentials → OAuth client ID (Web application), Authorised JavaScript origin = your app URL. Then Credentials → API key (restrict it to the Picker API and your domain).
4. Set `GOOGLE_CLIENT_ID`, `GOOGLE_API_KEY`, and `GOOGLE_APP_ID` (the project *number* from the project dashboard).

**Box** (connect once, then browse and import files or whole folders; folder names are kept):
1. developer.box.com → My Apps → Create new app → Custom App → **User Authentication (OAuth 2.0)**.
2. Redirect URI: `https://<your-app>/api/connect/box/callback`. Scope: *Read all files and folders stored in Box*.
3. Set `BOX_CLIENT_ID` and `BOX_CLIENT_SECRET`.

## 6. Auto-organise

Run `supabase/migrations/20261002000000_auto_organise.sql` in the SQL editor. Needs `ANTHROPIC_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` on Railway; nothing else to set up.

- Every new image, logo and product photo is queued. A worker inside the web server (started by `instrumentation.ts`) works through the queue every 20 seconds, and straight away after an upload or import. It asks Claude Haiku for a description, tags, colours (matched to the brand kit), text in the image, an on-brand check against the kit's imagery rules, and the product it shows.
- Older files: Settings → Auto-organise → "Organise N older files". Shows the rough cost first, then live progress.
- People's edits to tags, description, alt text and the product link always win.
- Smart collections are saved searches (`collections` table) and appear next to folders; starters are suggested from the tags. Near-duplicates are flagged with a perceptual hash worked out in the browser.
- Optional: `ANTHROPIC_TAG_MODEL` (default Haiku 4.5), `DISABLE_AUTO_TAG=1` to switch it off.
- Logic test: `npx tsc scripts/organise-selftest.ts --outDir /tmp/st --module commonjs --target es2022 --esModuleInterop --skipLibCheck && node /tmp/st/scripts/organise-selftest.js`

## 7. AI search

Run `supabase/migrations/20261002120000_search.sql` (turns on pgvector, adds full-text search and `search_assets`). Needs `VOYAGE_API_KEY` on Railway; without it search still works on keywords.

- Each asset's name, description, tags, colours and text in the image are embedded with Voyage (`asset_embeddings` table) by the same background worker, after auto-organise. Edits re-embed automatically.
- `/api/search` blends vector similarity with full-text ranking (reciprocal rank fusion) and applies filters. Searches of 3+ words also go to Claude Haiku, which turns them into filters (type, colour, orientation, folder, on-brand, drafts) shown as removable chips.
- The library shows keyword matches instantly, then swaps in the ranked results. The Claude connector (`list_assets`, `search_products`) uses the same search.
- Tuning (optional): `VOYAGE_MODEL` (default voyage-3.5), `SEARCH_MIN_SIMILARITY` (0.25), `SEARCH_SIMILARITY_WINDOW` (0.12).
- Logic test: `scripts/search-selftest.ts` (same command as the organise test).

## 8. Share links and brand portals

Run `supabase/migrations/20261002180000_sharing.sql`. No new keys needed (passcode cookies are signed with `SHARE_SECRET` if set, else the service-role key).

- **Share links** (`/s/<token>`): one file, several (select tiles in Assets), a folder or a smart collection. Expiry, optional passcode, downloads on or off and which formats (original, web 2000px, email-ready). Turn off any time; views and downloads are counted. Sharing → Links lists them all.
- **Brand portals** (`/p/<brand>/<portal>`): Sharing → Create brand portal makes one in a click: every approved file grouped by folder, styled from the brand kit (logo, colours, fonts), with a brand guidelines page generated from the kit. Several per workspace (Press, Retail partners…). Access: public, passcode, or an invite list (emails or @domain) with magic-link sign-in. Search uses the same AI search, limited to the portal. Visits, top downloads and who downloaded (invite list) for the last 30 days.
- Drafts and email blocks are never public. The brand's own team always sees a preview and isn't counted.
- Invite-list portals send sign-in emails through Supabase Auth, so they need Resend (or other SMTP) set up in Supabase to avoid its email rate limit. Add `https://<your domain>/auth/callback` to Supabase's redirect URLs (a `/**` wildcard covers it).

## 9. Edit and versions

Run `supabase/migrations/20261002210000_versions.sql`. Nothing else to set up.

- **Create makes new things; Edit changes an existing one.** Every edit is a new version of the same asset (`asset_versions` keeps the old ones; `asset_new_version` / `asset_revert` / `asset_save_copy` do the work in one transaction), so tags, folder, product link, collections and share links stay. Originals are never overwritten; restoring an old version keeps the current one too.
- **Photos and uploads:** Edit on the asset page opens the hands-on editor (`components/ImageEditor.tsx`, `lib/imageEdit.ts`): crop free or locked, sizes from the brand kit (email width at 2x), social formats, retail and the team's own sizes (saved in the brand kit), rotate, flip, brightness, contrast, saturation, remove white background. Save as a new version, save as a copy, or just download the result.
- **Designs made in the Studio:** Edit reopens them in the same Studio with the layout live (copy, images, change with words); saving makes a new version of that asset rather than a duplicate.
- **Downloads:** original file, or JPG / PNG / WebP at original, web (2000px) or email-ready (1200px) size.
- AI edit has its place next to Edit, marked "soon" (brief step 7).
- Logic test: `scripts/edit-selftest.ts` (same command as the other self-tests).

## 10. Plans and billing (Stripe)

**Free is a taster; Pro is £149 a month per brand (or £1,490 a year), with a 7-day free trial (card up front).**

- Free: build the brand kit, up to 50 files (all organised and searchable), one Studio run (a brief: its three designs and extra sizes), unlimited users, connect Claude.
- The trial pop-up opens at: file 51, a second Studio brief, any sharing (links, portals), editing (photo edits, design changes, Figma edits, restoring versions), licence dates and obsolete files, and a second brand.
- The database enforces it too (`20261006090000_free_taster.sql`): file 51 and edits raise `FREE_FILE_LIMIT` / `PRO_EDIT`; every brand after your first goes through checkout.
- Pro: unlimited files, sharing, editing, 200 Studio designs a month then 50p each up to a cap the owner sets, licence expiry and lifecycle.
- Each Pro brand has its own Stripe customer and subscription. Plans live in `workspace_billing`, which only the server writes.

Set up:
1. Run the migrations `20261005120000_billing_and_lifecycle.sql` and `20261006090000_free_taster.sql` (both at the end of `supabase/run-pending.sql`).
2. `STRIPE_SECRET_KEY=sk_test_… node scripts/stripe-setup.mjs` creates the meter, products, prices and portal settings, and prints the env lines.
3. In Stripe → Developers → Webhooks, add `https://<app>/api/billing/webhook` with `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`. Put its signing secret in `STRIPE_WEBHOOK_SECRET`.
4. Add the env vars to Railway. For UK VAT, turn on Stripe Tax, add the VAT registration, then set `STRIPE_TAX=1`.
5. Test with card 4242 4242 4242 4242. Settings → Plan shows the plan, this month's designs and the cap.

Without the Stripe env vars, billing stays off and every brand is on Free.

## 11. Assets that are no longer available

An asset can be **archived** (retired by hand), **expired** (its licence or usage rights ran out) or **obsolete** (superseded, e.g. an old logo, pointing to its replacement). They stay in the library, greyed with a badge, under *No longer available*, and are kept out of Studio, share links, portals and Claude (`list_assets` hides them unless `include_unavailable`; `get_asset` returns `availability`, `reason` and `use_instead`). Expired files can't be downloaded.

Set it in the asset's **Availability** panel, or ask Claude (`update_asset` with `availability`, `replaced_by`, `licence_expires_at`). Archive works on every plan; licence dates and replacements are on Pro. A licence date in the past counts as expired straight away; with pg_cron on, an hourly job (`expire_licences()`) also flips them in the database. Files whose licence ends within 30 days are flagged in the library.

## How the pieces fit

```
app/
  page.tsx                 signed-in library (components/Library.tsx)
  login/, auth/callback/   magic-link sign-in (also handles invite links)
  api/mcp/[key]/route.ts   MCP endpoint (streamable HTTP, stateless JSON)
  api/keys/route.ts        create connector links (only a hash is stored)
  api/invites/route.ts     invite teammates (owners)
  api/brand-kit/extract/   build a draft brand kit from a website
components/                Library, AssetPanel, BlockEditor, BrandKit, Modals
lib/brandKit.ts            brand kit shape, validation, merge, contrast checks
lib/brandExtract.ts        reads colours, fonts, buttons and logo from HTML/CSS
lib/mcp/server.ts          MCP protocol + tools (tested with a fake DB)
lib/mcp/repo.ts            Supabase data access for the MCP tools
lib/blockTypes.ts          block shapes and email export sizes
supabase/migrations/       schema, RLS, storage bucket
```

### MCP tools

| Tool | What it does |
| --- | --- |
| `list_workspaces` | Brand workspaces with counts per category |
| `list_assets` | Filter by workspace, kind and search |
| `get_asset` | Details plus a one-hour image URL; full fields for blocks |
| `search_products` | Products by name or PID |
| `get_block_for_figma` | Copy, image slots and field rules for building a component |
| `view_image` | Returns the image itself so Claude can read a finished design's text and layout |
| `push_image_to_figma` | Server uploads the image to a Figma `upload_assets` URL and returns the imageHash |
| `record_figma_placement` | Saves where a block or image lives in Figma |
| `get_brand_kit` | The workspace's brand kit, font stacks, logo URLs, what's missing and contrast warnings |
| `save_brand_kit` | Creates or updates the kit (e.g. from a Figma design system), imports a logo from a URL; always saved as a draft |
| `add_generated_asset` | Saves an AI-made image from a public https URL as a draft, with prompt, model and source product |

`list_assets` also filters by `origin` (uploaded, product_feed, generated) and `status` (approved, draft).

### Brand kit from a website

`/api/brand-kit/extract` fetches the page and its first six stylesheets, reads CSS variables, body/heading/link styles, the main button, `@font-face` and Google Fonts links, theme-color, the logo (scored images and inline SVGs near "logo" in the header, falling back to the touch icon) and the share image. Claude assigns roles and describes the imagery style from the share image; the logo and share image go into the library. It's a plain fetch, so sites that render everything with JavaScript give thinner results (a headless browser on Railway would fix that).

`push_image_to_figma` exists so images never pass through Claude: Claude asks Figma for an upload URL, and the Mise server sends the full-size file straight to Figma. Only `https://*.figma.com` upload URLs are accepted.

## Next up

- `generate_hero(product_pid, style, format)`: keep the real product cut-out, generate the scene around it with the brand kit's imagery rules, composite, save as a draft.
- Approval of brand kits is owner-only in the app; enforce it in the database too.
- Automatic feed sync (Google Merchant / Shopify URL on a schedule).
- OAuth sign-in for the Claude connector, replacing link keys.
- Server-side email renditions, so Claude can push any preset size.
- Email Love integration (Email Love customers only): components that come out ready for the Email Love plugin.


## Testing readiness (3 Oct 2026)
- **Monthly AI allowances (cost guards):** every workspace gets a monthly allowance for auto-organise (3,000 files), plain-English searches (2,000), Studio designs (300) and brand kits from a website (20). Change the defaults with `AI_CAP_TAG`, `AI_CAP_SEARCH`, `AI_CAP_DESIGN`, `AI_CAP_KIT`, or raise one brand in Supabase (`workspaces.ai_caps`, e.g. `{"tag": 20000}`). Over the limit: files wait with a clear note, search still works on words and meaning, the Studio says so. Usage shows in Settings → Auto-organise. Crossing 80% and 100% emails `ALERT_EMAIL` once a month.
- **Feedback:** a Feedback button in the sidebar. Messages are saved in the `feedback` table and emailed to `FEEDBACK_EMAIL` (or `ALERT_EMAIL`), with reply-to set to the sender.
- **Emails** use Resend's API: set `RESEND_API_KEY`, `ALERT_EMAIL` and `MAIL_FROM` (a sender on your verified domain) on Railway.
- **Migration:** `supabase/migrations/20261003000000_usage_and_feedback.sql`.
