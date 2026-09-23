# Emailsy CMS

A home for a team's email-ready assets: images, logos, feed products and content blocks.

- **Library:** upload images and logos, import a product feed (CSV), rename and move assets between categories.
- **Email-ready images:** crop to email sizes, remove white backgrounds, then drag straight into Figma.
- **Blocks:** Hero, Card, Product, Button and Footer content with copy and email-ready images.
- **Claude connector (MCP):** Claude can find assets, push full-size images into Figma, and turn blocks into components in any Figma design system.
- **Teams:** brand workspaces, invites and owner/editor roles.

Stack: Next.js 15 (App Router) · Supabase (Postgres, Auth, Storage) · Railway.

---

## 1. Supabase

1. Create a project at supabase.com.
2. Run the migration. Either:
   - **CLI:** `supabase link --project-ref <ref>` then `supabase db push`, or
   - **Dashboard:** SQL Editor → paste `supabase/migrations/20260923000000_init.sql` → Run.

   This creates the tables, row level security, the private `assets` storage bucket and realtime.
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

Check the MCP handler without a database: `npx tsx scripts/mcp-selftest.ts`.

## 3. GitHub → Railway

```bash
git init && git add -A && git commit -m "Emailsy CMS: first version"
gh repo create emailsy-cms --private --source=. --push   # or create the repo on github.com and push
```

In Railway: New Project → Deploy from GitHub repo → pick `emailsy-cms`.
Add the four variables under Variables, then Settings → Networking → Generate Domain.
Set `NEXT_PUBLIC_APP_URL` to that domain and redeploy (it is baked in at build time).
`railway.json` sets the build and start commands and the `/api/health` health check.

## 4. Connect Claude

1. Sign in to Emailsy CMS → **Claude connector** → **Create my connector link**.
2. In Claude: Settings → Connectors → **Add custom connector** → name it *Emailsy CMS* → paste the link.
3. Also connect Figma's MCP. Then try: *"Put the Autumn hero image from Emailsy onto my selected Figma frame"* or use a block's **Copy request for Claude**.

The link contains a secret key. Anyone with it can read that user's workspaces, so treat it like a password; turn it off in the app if it leaks.

## How the pieces fit

```
app/
  page.tsx                 signed-in library (components/Library.tsx)
  login/, auth/callback/   magic-link sign-in (also handles invite links)
  api/mcp/[key]/route.ts   MCP endpoint (streamable HTTP, stateless JSON)
  api/keys/route.ts        create connector links (only a hash is stored)
  api/invites/route.ts     invite teammates (owners)
components/                Library, AssetPanel, BlockEditor, Modals
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
| `push_image_to_figma` | Server uploads the image to a Figma `upload_assets` URL and returns the imageHash |
| `record_figma_placement` | Saves where a block or image lives in Figma |

`push_image_to_figma` exists so images never pass through Claude: Claude asks Figma for an upload URL, and the Emailsy server sends the full-size file straight to Figma. Only `https://*.figma.com` upload URLs are accepted.

## Next up

- Automatic feed sync (Google Merchant / Shopify URL on a schedule).
- OAuth sign-in for the Claude connector, replacing link keys.
- Server-side email renditions, so Claude can push any preset size.
- Email Love integration (Email Love customers only): components that come out ready for the Email Love plugin.
