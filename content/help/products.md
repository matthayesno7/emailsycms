---
title: "Products: Shopify, feed links and CSV"
description: Bring your products in with their photos, prices and links, keep them in sync, and use them in designs and emails.
category: Your library
order: 3
---

# Products: Shopify, feed links and CSV

Products come into Mise with their photo, name, price, link and description, ready to use in designs, emails and Claude.

## Add your products
**Assets → Add → Add products** (or **Your products** on an empty library). Choose one:

### Connect Shopify
1. Type your store's address, for example `yourstore.com` or `yourstore.myshopify.com`.
2. Click **Connect**.

Mise reads your store's **published** products: names, images, prices and links. There's nothing to install, and Mise never changes your store. Products that aren't published to your online store aren't included.

### Feed link
Paste the link to a product feed and click **Import**. This works with:
- A **Google Merchant** feed (Products → Feeds → your feed → copy its link).
- A **Google Sheet** published as CSV (File → Share → Publish to web → CSV).
- Any CSV, TSV or XML (RSS/Atom) feed link.

### Upload a CSV
A one-off file, for example a Shopify product export or a Google Merchant export. It needs a product ID column. See [Columns Mise reads](#columns-mise-reads).

## Kept in sync
Shopify stores and feed links are listed under **Kept in sync** in the same window, with the number of products and when they last synced.
- **On Pro, Mise checks them every day.** On Free, press **Sync now** when your products change.
- **New products** are added, and **prices, links and photos** are updated.
- **Products that leave the feed** are marked *No longer available* (with the reason "No longer in the product feed"), not deleted, so past designs still make sense. If they come back, they're made available again.
- **Safety net:** if a feed suddenly loses more than half its products, Mise assumes something went wrong and doesn't remove anything.
- **Stop syncing** stops future syncs. The products stay in your library.

A CSV upload is a one-off: upload it again to update.

## Your edits are kept
If your team changes a product's **name, label, description or button**, those changes stay, even when the feed syncs. **Price, link and photo always follow the feed.**

## Columns Mise reads
Column names aren't case-sensitive, and a `g:` prefix (Google Merchant) is ignored.

| Field | Column names |
|---|---|
| Product ID (required) | `id`, `pid`, `sku`, `item_id`, `product_id`, `handle` |
| Name | `title`, `name`, `product_name` |
| Price | `sale_price`, `price`, `variant price` |
| Link | `link`, `url`, `product_url` |
| Photo | `image_link`, `image`, `image_url`, `image src` |
| Description | `description`, `short_description`, `body_html`, `body`, `body (html)` |

Rows with the same product ID are counted once. HTML is removed from descriptions, and a short email version (about 140 characters) is made; the full description is kept too.

## Product photos
Mise downloads each product's photo from the feed in the background (up to 25 MB each).
- **A product with no photo** shows its ID on the tile: "Drop {ID}.jpg to add its image". Drop a file named after the product ID (for example `10482.jpg` or `.png`) anywhere on Assets and it attaches to that product.
- **Photos that couldn't be downloaded** are listed under **Products without a photo** in [Review](review).

On Free, product photos count towards the 50 files. Product records without photos don't.

## The product page
Click a product to open it.
- **Product card** shows how it looks in an email with your brand kit: photo, name, description, price and button. Click the card to edit it.
- **Photo** shows just the photo, to zoom, copy or download.
- The side panel shows **Label, Description, Alt text, Button, Price, Link and PID**, each with a copy button, plus **View on the website**.
- **Edit** opens the product card editor: Label (30 characters), Name (60), Description (160), Price (16), Button (20; leave empty for no button) and Link. **Crop and adjust the photo** opens the photo tools.

## Using products
- In **Create**, choose **Start from a photo** and pick a product: Mise keeps the product exactly as it is and puts it in a new scene. See [Create photos and video](create-photos-video).
- **Use in a block** makes a Product email block. See [Email blocks](email-blocks).
- In **Claude**, ask for "a product grid email with our three newest products" and it finds them with Mise.

## Problems
| Message | What to do |
|---|---|
| "That doesn’t look like a Shopify store, or its product list is switched off" | Check the address (try `yourstore.myshopify.com`). Some stores turn off their public product list; use a feed link or CSV export instead. |
| "That link opens a web page, not a feed." | Use the feed's own link, not the page you view it on. In Google Merchant: Feeds → your feed → Settings. |
| "Couldn’t find a product ID column (id, pid, sku or item_id)." | Add or rename a column so one of these names is used. |
| "The feed has no product rows." / "The feed has no products in it." | The file or feed is empty, or the first row isn't the column names. |
| "That isn’t a public web address." | The link must be public (https), not on your own network. For Google Sheets, publish it to the web first. |
| A sync shows an error under **Kept in sync** | Press **Sync now** to retry. If the store or feed moved, **Stop syncing** and add it again. |
