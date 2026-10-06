---
title: Connect Claude
description: Add Mise to Claude (web, desktop or Claude Code) and other AI tools, and fix connection problems.
category: Claude and integrations
order: 1
---

# Connect Claude

The Mise connector gives Claude your brand kit and assets, lets it make designs, photos and video with Mise, and gives it a place to save what it makes. Set it up once per person.

## 1. Create your Mise link
Settings → **Claude** → **Create my link**. Copy the link straight away: it's **shown once**. It's personal, so treat it like a password.

## 2a. Claude (web and desktop)
1. In Claude, open **Settings → Connectors** → **Add custom connector**.
2. Name it **Mise** and paste your link.
3. **Start a new chat.** Connectors load when a chat starts.

Custom connectors need a Claude plan that supports them.

## 2b. Claude Code
**Easiest:** after creating your link, click **Copy setup brief** and paste it into Claude Code. Your link is already in it: Claude adds Mise and checks it's connected.

Or run this yourself in your terminal:
```
claude mcp add -s user --transport http mise "YOUR-MISE-LINK"
```
Then **restart Claude Code** (type `/exit`, then run `claude` again). Check with `claude mcp list`: mise should show as Connected.

Mise's prompts also appear in Claude Code's `/` menu.

## 2c. Other AI tools
Any tool that supports MCP connectors over HTTP (for example Cursor or Codex) can use the same link. Add a new MCP server with your Mise link as its URL, then restart the tool.

## 3. Optional: Figma
If your team designs in Figma, add the **Figma** connector too (from Claude's connector directory, or `claude mcp add -s user --transport http figma https://mcp.figma.com/mcp` in Claude Code, then sign in through `/mcp`). See [Using Mise with Figma](figma).

## 4. Try it
In a new chat, ask: "Show me my Mise brand kit." Then try "Make a LinkedIn post for our new arrivals and save it to Mise."

## Your links
Settings → **Claude** → **Your links** lists your links with when each was last used. **Turn off** a link to stop it working straight away, for example if it was shared by mistake. Then create a new one and update Claude.

A link reaches every brand you're a member of, with your role in each.

## Problems
| What happens | What to do |
|---|---|
| Claude doesn't mention Mise or its tools | Start a **new chat** (or restart Claude Code). Check the connector is switched on in that chat. |
| "This connector link is not valid. Create a new one in Mise → Claude connector." | The link was turned off or mistyped. Create a new link and replace it in Claude. |
| Claude Code shows mise as **failed** or **needs authentication** | The link is wrong or turned off. Run `claude mcp remove -s user mise`, create a new link in Mise, and add it again. |
| "That workspace is not one of yours…" | Claude used a brand you're not a member of. Ask it to list your workspaces first. |
| "…(Your role in this brand: Viewer.)" | Your role can't do that. Ask an admin for more access. |
| "…is on Pro…" | That feature (sharing, editing, photos, video) needs the brand on Pro. |
