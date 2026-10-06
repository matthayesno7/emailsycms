---
title: Adding files
description: Upload files and folders, drag and drop, paste, file types and size limits.
category: Your library
order: 1
---

# Adding files

You need to be an owner, admin or editor (or a contributor on Enterprise) to add files. Viewers can't.

## Ways to add files
On **Assets**:
- **Drag and drop** files or whole folders anywhere on the page. You'll see "Drop to add".
- **Paste** (⌘V or Ctrl+V) an image anywhere outside a text box.
- Click **Add** and choose:
  - **Upload files**: images, logos, videos and product CSVs.
  - **Upload a folder**: keeps the folder's name, like Dropbox. Subfolders come in too.
  - **Add products**: Shopify, a feed link or a CSV. See [Products](products).
  - **Import from Drive, Dropbox or Box**. See [Importing from the cloud](importing-from-cloud).
  - **New folder** and **New email block**.

If a folder is open when you upload, files go into that folder.

## What happens to each file
- **Its name** comes from the file name, with dashes and underscores turned into spaces.
- **Its type** is worked out for you: videos become Videos; SVGs and files with "logo", "wordmark" or "brandmark" in the name become Logos; everything else is an Image. Change it on the file's page under **Type**.
- **An email-ready copy** is made automatically for larger photos: at most 1200px wide and compressed, ready for email tools. SVGs, GIFs and photos that are already small enough are used as they are. The original is kept exactly as you uploaded it.
- **It's organised**: a description, tags, colours, any text in the picture, alt text and a brand check, a few seconds later. See [How Mise organises your files](auto-organise).
- **Duplicates are flagged**: if it looks like a copy of a file you already have, you'll see "{name} looks like a copy of {other}. It’s flagged so you can decide." See [Duplicates](duplicates-and-brand-checks).
- **Product photos attach to products**: an image named after a product ID (for example `10482.jpg`) attaches to that product instead of becoming a new file ("Attached to {product}").

## File types and sizes
| | Accepted | Largest file |
|---|---|---|
| Images | PNG, JPEG, WebP, GIF, SVG (AVIF when imported from the cloud) | 50 MB |
| Videos | MP4, WebM, MOV | 1 GB |
| Product feeds | CSV | — |

Files whose names start with a dot (hidden system files) are skipped.

## Plan limits
**Free** includes up to **50 files** (anything with a stored file, including product photos; email blocks don't count). When you reach 50, Mise adds what fits and shows **Upgrade to Pro** for the rest. **Pro** has no file or storage limit. See [Plans](plans).

## Something went wrong?
| Message | What to do |
|---|---|
| "{name} is {size}. Images can be up to 50 MB." / "Videos can be up to 1 GB." | Export a smaller copy (for images, 4000px wide is plenty) and try again. |
| "Couldn’t upload {name}." / "Couldn’t save the image." | Check your connection and try again. If it keeps happening with one file, re-export it as JPG or PNG. |
| "Viewers can look and download, not change files…" | Your role is Viewer. Ask an admin for contributor or editor access. |
| The upgrade pop-up appears | You've reached Free's 50 files. Upgrade, or remove files you don't need. |
