// The words of Mise's welcome emails. Links are real app links (appUrl() is https://app.misedam.com in production).
import type { Email } from './template';
import { appUrl } from '../keys';

export const greetingFor = (name?: string | null) => {
  const first = (name || '').trim().split(/\s+/)[0];
  return first && /^[\p{L}][\p{L}'’-]*$/u.test(first) ? `Hi ${first[0].toUpperCase()}${first.slice(1)},` : 'Hi there,';
};
// Pro is $3,750 a year per brand, in US dollars for everyone (lib/plans.ts).

export function welcomeEmail(o: { name?: string | null }): Email {
  const app = appUrl();
  return {
    subject: 'Your Mise brand kit is ready. Here’s what to do next',
    preheader: 'Ten minutes to a brand library that organises itself.',
    greeting: greetingFor(o.name),
    intro: [
      'Matt here, co-founder of Mise. Thanks for signing up.',
      'Your brand kit is the start. Mise really clicks once you’ve done three things, and together they take about ten minutes.',
    ],
    steps: [
      {
        title: 'Bring in your files (3 minutes)',
        body: 'Drop a folder of logos and photos onto Assets, or click Add → Import from Drive, Dropbox or Box. Every file is tagged, described and given alt text a few seconds after it lands. Then search by describing what you want, like “lifestyle shot, blue background”, and watch it find the right one.',
        link: { label: 'Add your files', url: app },
      },
      {
        title: 'Share them with one link (2 minutes)',
        body: `Open a folder, click Share and send the link to your agency or a retailer. It’s styled with your brand kit, nobody needs a login, and you’ll see who viewed and downloaded. Add new files to the folder later and they appear in the link automatically. Sharing is on Pro: $3,750 a year per brand, with unlimited files and people.`,
        link: { label: 'How share links work', url: `${app}/help/share-links` },
      },
      {
        title: 'Connect Claude (5 minutes)',
        body: 'In Mise, go to Settings → Claude → Create my link. In Claude, open Settings → Connectors → Add custom connector, name it Mise and paste the link. Start a new chat and ask “Show me my Mise brand kit.” From then on Claude uses your real logos, colours and photos instead of guessing, and saves what it makes back to Mise for your team to approve.',
        link: { label: 'Step-by-step', url: `${app}/help/claude-connector` },
      },
    ],
    outro: [
      'One more thing: Mise is priced per brand, not per person, so invite everyone who needs your files from Settings → Team. It’s free on every plan.',
      'If anything’s unclear, just reply. It comes straight to me.',
    ],
  };
}

export function proEmail(o: { name?: string | null; brand: string }): Email {
  const app = appUrl();
  return {
    subject: 'You’re on Mise Pro. Here’s what just unlocked',
    preheader: 'Share links, portals, unlimited files and 200 designs a month.',
    greeting: greetingFor(o.name),
    intro: [
      `Thanks for upgrading ${o.brand} to Pro. It means a lot this early on, and I’d love to hear what tipped you over. Just reply.`,
      'Here’s what you can do now that you couldn’t yesterday:',
    ],
    steps: [
      {
        title: 'Bring in everything',
        body: 'There’s no file limit any more. Import the rest of your library from Drive, Dropbox or Box (Assets → Add), and Mise organises every file as it lands.',
      },
      {
        title: 'Send one link instead of attachments',
        body: 'Open a folder or collection, click Share and send it to your agency or retailers. Set an expiry date or passcode, choose which sizes they can download, and see who opened it. Want something more permanent? Sharing → Create brand portal gives partners one page with your approved files and brand guidelines.',
        link: { label: 'Share links', url: `${app}/help/share-links` },
      },
      {
        title: 'Make new work from your library',
        body: 'Create now gives you 200 designs a month, plus new product photos and short videos in your brand’s style. Everything AI makes lands in Review for you to approve first.',
        link: { label: 'Open Create', url: app },
      },
      {
        title: 'Stop out-of-date files being used',
        body: 'Set a licence end date on stock photos and Mise blocks them automatically on that day. Mark an old logo obsolete and point people to the new one.',
      },
    ],
    outro: [
      'If you haven’t yet, connect Claude (Settings → Claude → Create my link) and invite your team (Settings → Team). People are free, so add everyone.',
      'Your invoices, card and VAT number are under Settings → Plan & usage → Manage billing.',
      'Anything you’d change, anything that’s missing, reply here. It comes straight to me.',
    ],
  };
}
