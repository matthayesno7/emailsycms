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
