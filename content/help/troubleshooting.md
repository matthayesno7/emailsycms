---
title: "Troubleshooting: every message explained"
description: What each message in Mise means and exactly what to do about it.
category: Help
order: 1
---

# Troubleshooting: every message explained

Search this page (⌘F or Ctrl+F) for the words you see.

## First things to try
1. **Reload the page.** Most one-off glitches go away.
2. **Check you're in the right brand.** The brand name is at the top of the sidebar.
3. **Check your plan and role.** Many messages mean "this is on Pro" or "your role can't do this". See [Plans](plans) and [Roles](team-and-roles).
4. **Try another browser**, or turn off ad blockers for Mise, if uploads, copying or pop-ups don't work.

## Signing in
| Message | What to do |
|---|---|
| "That sign-in link has expired or was already used…" | Links work once, for an hour. Send a new one and open it straight away, or use Google. |
| "That sign-in link didn’t work…" | Open the link in the same browser you asked for it from, or use Google. |
| "Google sign-in isn’t switched on yet…" | Use an email link. |
| "Email rate limit exceeded" or a similar message after asking for a link | Too many links were requested. Wait a few minutes, or use Google. |
| "Couldn’t load your library. Reload to try again." | Reload. If it persists, sign out and back in. |
| "That isn’t in your workspaces any more." | The file was deleted, or you were removed from that brand. |

## Adding files
| Message | What to do |
|---|---|
| "{name} is {size}. Images can be up to 50 MB." / "Videos can be up to 1 GB." | Export a smaller copy. |
| "{name} is too large to upload…" | Same as above. |
| "Couldn’t upload {name}." / "Couldn’t save the image." | Check your connection and try again; re-export unusual files as JPG or PNG. |
| The upgrade pop-up when adding files | Free holds 50 files. Upgrade, or delete files you don't need. |
| "Viewers can look and download, not change files…" / "…not add or make things…" | Ask an admin for contributor or editor access (Enterprise). |
| "Contributors can change only the files they added." | Ask an editor, or ask an admin for editor access. |
| "An editor approves files. Contributors’ work waits in Review." | Your files are in Review; an editor will approve them. |
| "{name} looks like a copy of {other}…" | Not an error: decide in Review whether to keep both. |
| "Attached to {product}" | Not an error: the file was named after a product ID, so it became that product's photo. |

## Importing
| Message | What to do |
|---|---|
| "Not switched on yet. Upload a folder from your computer for now." | That source is temporarily unavailable. Download the files and use **Upload a folder**. |
| "Box needs connecting again." / "Couldn’t connect Box. Try again." | Click Box and sign in again. |
| "No images or videos in that folder." | The folder has no supported files. |
| "Dropbox didn’t load…" / "Google Drive didn’t load…" / "Box didn’t respond." | Allow pop-ups for Mise and try again in a few minutes. If it keeps happening, download the files and use **Upload a folder**. |
| "{n} couldn’t be copied" | Too big or an unsupported format. Upload those directly. |

## Products
| Message | What to do |
|---|---|
| "That doesn’t look like a Shopify store, or its product list is switched off…" | Check the address, try `yourstore.myshopify.com`, or use a feed link or CSV. |
| "That link opens a web page, not a feed." | Use the feed's own link. |
| "Couldn’t find a product ID column (id, pid, sku or item_id)." | Rename a column. See [columns](products#columns-mise-reads). |
| "The feed has no product rows." / "…has no products in it." | The feed is empty, or the first row isn't column names. |
| "That isn’t a public web address." | Use a public https link. Publish Google Sheets to the web first. |
| "Couldn’t download the feed (…)." | The feed's server didn't respond. Try **Sync now** later. |
| "Type your store’s address, like yourstore.com…" | Enter just the address, not a product page. |
| "{n} product images added. {m} couldn’t be downloaded…" | Drop files named {ID}.jpg onto Assets for those products. |

## Organising and search
| Message | What to do |
|---|---|
| "Couldn’t organise: …" / "{n} couldn’t be read" | Click **Try again**. If it keeps failing, re-export as JPG or PNG. |
| "Too large to organise (over 5 MB). Upload a smaller copy." | Upload a smaller version. |
| "Claude couldn’t read this image…" | The file may be damaged or unusual. Re-export it. |
| "This brand has used its files organised for this month…" | You reached the fair-use ceiling (20,000 a month). It resets on the 1st. |
| "Nothing matches “…”." | Try fewer or different words, or describe what's in the picture. |

## Editing
| Message | What to do |
|---|---|
| "Editing files is on Pro…" / "Changing designs is on Pro…" | Upgrade the brand. |
| "This image couldn’t be loaded for editing." | Reload and try again. |
| "The edited file is over the size limit." | Choose a smaller size. |
| "Couldn’t save the edit: …" / "Couldn’t upload the edit." | Check your connection and save again. |
| "Couldn’t restore that version." | Reload and try again. |
| "Couldn’t delete. Try again." | Reload; check your role. |
| "Couldn’t save that change. Try again." | Reload; check your role. |

## Create
| Message | What to do |
|---|---|
| "Your free Studio run is used…" | Upgrade to Pro to keep creating. |
| "Claude didn’t return a design. Try again." | Click **Try again** on that design. |
| "Couldn’t make that change." | Reword it, or make it in smaller steps. |
| "Couldn’t reach Mise." | Check your connection and try again. |
| A banner about the monthly cap for extra designs | An owner can raise the cap in Settings → Plan & usage, or wait for the 1st. |
| "Making new images is on Pro…" / "Making video is on Pro…" | Upgrade the brand. |
| "No image came back… Try rewording the request." | Reword it; avoid real people's names and anything that reads as unsafe. |
| "The clip was blocked by the model’s safety filter…" | Reword the description. |
| "The image took too long. Try again." | Try again. |
| "Image generation isn’t switched on…" / "Video isn’t switched on…" | Temporarily unavailable. Try again later. |

## Brand kit
| Message | What to do |
|---|---|
| "Couldn’t open {url} (…). Check the address, or try the brand’s main shop page." | Check the address; try the homepage or shop page. |
| "That address isn’t a web page." / "Add a website address, like yourbrand.com." | Enter a website address. |
| "Couldn’t read that website. Try again." | Try again, or start with a blank kit. |
| "An admin or owner approves the kit." | Ask an admin or owner to approve. |
| "{font} has no web font link…" | Add a Google Fonts CSS link, or choose a fallback that looks close. |
| Contrast warnings | Adjust colours so text is easy to read. |

## Sharing
| Message | What to do |
|---|---|
| "Sharing is on Pro…" / "Publishing your portal is on Pro…" | Upgrade the brand. |
| "That needs an editor, admin or owner of this brand." | Ask someone with that role (Enterprise). |
| "Use a passcode of at least 4 characters." / "Set a passcode of at least 4 characters." | Make it longer. |
| "Set a passcode, or choose another kind of access." | Add a passcode, or choose Anyone with the link or Invite list. |
| "That address is taken. Try another." | Pick a different brand address. |
| "Couldn’t create the link. Try again." / "Couldn’t change it." | Try again. |
| Recipients say a link doesn't open | Check Sharing → Links: expired, turned off, or the brand is on Free. See [What recipients see](what-recipients-see). |

## Team
| Message | What to do |
|---|---|
| "Only admins and owners can invite people…" | Ask an admin or owner. |
| "Admin, contributor and viewer roles are on Enterprise…" | Invite as an editor, or [book a call](https://calendar.notion.so/meet/matthayes/3363f4yal) about Enterprise. |
| "Only an owner can make or change an owner." | Ask an owner. |
| "A brand needs at least one owner…" | Make someone else an owner first. |
| "Couldn’t remove them." | Reload and try again. Only admins and owners can remove people. |

## Billing
| Message | What to do |
|---|---|
| "Only owners can upgrade a brand." / "Only owners can manage billing." | Ask an owner. |
| "Couldn’t open checkout…" / "Couldn’t reach billing…" | Try again in a minute. |
| "payment failed, Stripe is retrying" | Update your card in Manage billing. |
| "Couldn’t stop this brand’s subscription, so it wasn’t deleted…" | Try again. Nothing was deleted. |

## Claude
| Message | What to do |
|---|---|
| "This connector link is not valid…" | Create a new link in Settings → Claude and replace it in Claude. |
| Claude doesn't see Mise | Start a new chat, or restart Claude Code. |
| "That workspace is not one of yours…" | Ask Claude to list your workspaces first. |
| "…(Your role in this brand: …)" | Your role can't do that; ask an admin. |
| "…is on Pro…" | That needs the brand on Pro. |

Still stuck? See [Still stuck?](contact).
