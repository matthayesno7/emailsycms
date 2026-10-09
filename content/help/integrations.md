---
title: "Use Mise inside other tools: the picker and permanent links"
description: Let Bloomreach, your CMS or email builder pick approved files straight from Mise, with links that always show the latest version.
category: Claude and integrations
order: 4
---

# Use Mise inside other tools: the picker and permanent links

Tools like Bloomreach can show the **Mise picker** inside their own screens. People search your library, pick approved files and drop them into a campaign or page without leaving that tool. Integrations are on **Pro** and **Enterprise**.

Each file the tool receives comes with a **permanent link**:
- It always shows the **current version**. Replace a file in Mise and every campaign using the link updates.
- It **stops working** the moment a file is archived, marked obsolete or deleted, or its licence runs out, so nobody keeps using a photo you're no longer allowed to use.
- Only **approved, available** files appear in the picker. Drafts and retired files never do.

## Set it up
You need to be an owner or admin of the brand.
1. Settings → **Integrations**.
2. Under **Add a tool**, type a name (for example "Bloomreach") and the **sites that show the picker**, one per line. `*.example.com` covers every subdomain; add `example.com` too if the tool uses the bare address. Ask the tool's team if you're not sure which addresses it uses.
3. Click **Create key**. The key is **shown once**: copy it and give it to whoever sets up the tool.
4. **Test the picker** opens it on its own, in test mode: pick a file and click **Show result** to see exactly what the tool will receive.

The picker only opens inside the sites you listed, and only sends what's picked to them. To change the sites, click **Edit sites**. **Turn off** stops the picker in that tool straight away; links to files it has already added keep working.

## Using the picker
- Search by name, tag or what's in a picture, and switch between **All**, **Images**, **Logos** and **Products**.
- Click a file to select it, then **Insert**. If the tool allows several, click more files (they're numbered in the order you pick them). In single-file mode, double-click inserts straight away.
- **Cancel** or Esc closes it without adding anything.

On Enterprise, every pick is recorded in the [Activity log](activity-log) (which tool, which files, which site).

## Permanent links
A permanent link looks like `https://app.misedam.com/a/…/summer-hero.jpg`.

| Add to the end | You get |
|---|---|
| nothing | The original file |
| `?f=email` | The email-ready copy (up to 1200px wide, compressed), when there is one |
| `?w=800` | Resized to 800px wide (PNG, JPEG and WebP, 50 to 3000px) |

Links are cached for up to an hour, so a new version or a retired file can take up to an hour to show everywhere. If the brand goes back to Free, its permanent links stop working until it upgrades again.

## Problems
| You see | What to do |
|---|---|
| "This site can't use this picker yet" | Add the address shown to the key's sites in Settings → Integrations → **Edit sites**. |
| "This picker link isn't working" | The key was mistyped or turned off. Create a new key. |
| "This picker is switched off" | The brand isn't on Pro or Enterprise. An owner can upgrade it. |
| A file you expected isn't in the picker | It's a draft (approve it in [Review](review)), or it's archived, expired or obsolete. |
| An image link shows "no longer available" | The file was archived, expired, marked obsolete or deleted. Use its replacement and update the campaign. |

## For developers
The picker is a web page your tool shows in an iframe (or a pop-up window). It talks to your page with `postMessage`.

**Embed it**

```
<iframe src="https://app.misedam.com/picker?key=mpk_…&multiple=1" style="width:100%;height:640px;border:0" allow="clipboard-write"></iframe>
```

Options in the address: `key` (required), `multiple=1` to allow several files, `types=image,logo,product,video` to limit what can be picked (default: images, logos and products).

**Messages your page receives** (always check `event.origin === "https://app.misedam.com"`):

| type | When | Data |
|---|---|---|
| `mise:ready` | The picker has loaded | `multiple`, `brand` |
| `mise:select` | Someone clicked Insert | `assets`: the picked files |
| `mise:cancel` | Someone clicked Cancel or pressed Esc | none |

Every message also has `source: "mise"`. If your page loads the picker with no referrer, send `{ type: "mise:hello" }` to the iframe after it loads, so the picker knows which page it's on.

**Each asset**

| Field | |
|---|---|
| `id` | Mise's id for the file |
| `name`, `alt`, `description`, `tags` | Text from Mise (alt text for accessibility) |
| `type` | `image`, `logo`, `product` or `video` |
| `mime`, `width`, `height`, `bytes` | The original file |
| `url` | Permanent link to the original |
| `email_url` | Permanent link to the email-ready copy, or null |
| `thumbnail_url` | A small version for your own previews |
| `product` | For products: `id`, `title`, `price`, `link`, `label`, `button`; otherwise null |
| `brand` | The brand's name in Mise |

**Or use the script**, which handles the messages, the hello and a ready-made pop-over:

```
<script src="https://app.misedam.com/mise.js"></script>
<script>
  Mise.pick({ key: 'mpk_…', multiple: true }).then(function (assets) {
    // [] if they cancelled
  });
  // Or keep it open inside your own element:
  // Mise.embed(document.getElementById('dam'), { key: 'mpk_…', onSelect: function (assets) { … } });
</script>
```

Store the `url` (or `email_url`), not a copy of the file: Mise stays the master copy, and the link keeps campaigns up to date and compliant.
