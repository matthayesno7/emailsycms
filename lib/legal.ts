// Mise's Terms and Privacy Policy. Plain text, rendered by components/LegalPage.tsx.
// A paragraph starting "- " is a bullet. Anything in [square brackets] still needs filling in.
// DRAFT: have a solicitor review before relying on these.

export const COMPANY = {
  name: 'HW Tech Ltd',
  trading: 'Mise',
  number: '15834771',
  address: '86-90 Paul Street, London, England, EC2A 4NE',
  ico: '', // add once registered, and put the sentence back in PRIVACY → Who we are
  email: 'hello@misedam.com',
  updated: '6 October 2026',
};

export type Section = { h: string; p: string[] };

const C = COMPANY;

export const TERMS: Section[] = [
  { h: 'About these terms', p: [
    `These terms are an agreement between you and ${C.name}, a company registered in England and Wales (company number ${C.number}), registered office ${C.address}, trading as ${C.trading} (“Mise”, “we”, “us”). They cover your use of Mise: the app, brand portals, share links, the Claude connector and the website at misedam.com.`,
    'Mise is for businesses. By creating an account you confirm you are using it for your business, and that you can agree to these terms for the organisation you use it for. If you agree on behalf of an organisation, “you” means that organisation.',
    'If you have an Enterprise contract with us, that contract takes priority where it differs from these terms.',
  ] },
  { h: 'Your account', p: [
    'You need an account to use Mise. Keep your sign-in secure and tell us straight away if you think someone else has access. You are responsible for what happens in your account and in the brands you own, including what your teammates do.',
    'Each brand (workspace) has one or more owners. Owners control the brand’s plan, billing, members and settings.',
  ] },
  { h: 'Plans and payment', p: [
    'Free: you can try Mise without a card, within the limits shown in the app (currently a brand kit, up to 50 files and one Create run per brand). We may change what Free includes.',
    'Pro: per brand, charged when you upgrade, plus VAT or sales tax where it applies. It is US$3,750 a year, billed yearly in US dollars (brands that subscribed before 9 October 2026 keep the price and currency they signed up on). Pro brands get 200 designs a month (designs, photos and video made in Create or by Claude through Mise); each design beyond that costs 60¢ (50p in pounds), up to a monthly cap the brand’s owner sets, and is billed in arrears on the next invoice. A brand keeps the currency it first paid in.',
        'Subscriptions renew automatically at the end of each month or year until cancelled. You can cancel at any time in Settings → Plan → Manage billing; the brand stays on Pro until the end of the period you have paid for, then returns to Free. We do not refund part periods unless the law requires it.',
    'Payments are processed by Stripe. If a payment fails we will retry it, and we may move the brand to Free if it remains unpaid.',
    'We may change prices with at least 30 days’ notice by email. A change takes effect from your next renewal after the notice period; you can cancel before then.',
  ] },
  { h: 'Your content', p: [
    'Your content is everything you or your team put into Mise: files, brand kits, text, product data and the things you make with it. You keep all rights in your content.',
    'You give us permission to host, copy, process, transform (for example, to make email-ready versions, thumbnails and new designs) and display your content, only as needed to run Mise for you, including showing it to the people you share it with through links and portals.',
    'You are responsible for your content and for having the rights to use it, including any licences for photos, fonts and other material. Mise’s licence-expiry and availability features are there to help you manage rights; they do not check or guarantee them.',
    'We do not sell your content and we do not use it to train AI models.',
  ] },
  { h: 'AI features', p: [
    'Mise uses AI to organise files, search your library, build brand kits and create designs. We send the content needed for each feature to our AI providers (listed in our Privacy Policy) under terms that do not let them train on it.',
    'AI output can be wrong or unsuitable. Review what Mise makes before you publish it. As between you and us, you own the designs and other output Mise creates for you, as far as the law allows.',
    'When you connect Claude to Mise, Claude acts for you under your own agreement with Anthropic. Mise only does what your connection’s permissions allow.',
  ] },
  { h: 'Sharing', p: [
    'When you share files through a link or a portal, anyone with access to that link or portal can see (and, if you allow it, download) what it contains. You decide what to share and with whom, and you can turn links and portals off at any time.',
  ] },
  { h: 'Acceptable use', p: [
    'Please don’t use Mise to:',
    '- break the law, or infringe anyone’s intellectual property, privacy or other rights;',
    '- store or share content that is unlawful, abusive or sexualises children, or malware;',
    '- use it as general file hosting, a content delivery network or for backups unrelated to brand assets;',
    '- get around plan limits, security or access controls, or overload the service;',
    '- copy, resell or build a competing product from Mise, or scrape it.',
    '“Unlimited” on Pro means unlimited for normal brand libraries. We may contact you, and if needed limit or suspend an account, where use is abusive or puts the service or other customers at risk. Where we can, we will tell you first and give you a chance to fix it.',
  ] },
  { h: 'Our service', p: [
    'We work hard to keep Mise available and your content safe, but we do not promise it will be uninterrupted or error-free. We may improve, change or remove features. If we remove something material from a paid plan, we will tell you in advance.',
    'Mise, its software and its design belong to us and our licensors. These terms give you the right to use Mise; they do not transfer any of our intellectual property to you. If you send us feedback, we may use it freely.',
  ] },
  { h: 'Data protection', p: [
    'Our Privacy Policy explains how we handle personal data. Where we process personal data in your content on your behalf, we do so as your processor under our Data Processing Agreement (app.misedam.com/dpa), which forms part of these terms. Our Security page (app.misedam.com/security) describes how we protect your data.',
  ] },
  { h: 'Ending your account', p: [
    'You can stop using Mise at any time. Owners can delete a brand in Settings, which deletes its content. To close your whole account, email us.',
    'We may suspend or close an account that seriously or repeatedly breaks these terms, or that stays unpaid.',
    'When a brand or account is deleted, we delete its content from the live service within 30 days and from backups within a further 90 days, except where the law requires us to keep something (for example, invoices).',
  ] },
  { h: 'Liability', p: [
    'Nothing in these terms limits liability for death or personal injury caused by negligence, for fraud, or anything else the law does not allow us to limit.',
    'We are not liable for loss of profits, revenue, business, goodwill or data, or for any indirect or consequential loss.',
    'Otherwise, our total liability to you in any 12 months is limited to the amount you paid us in those 12 months, or £100 if that is more.',
  ] },
  { h: 'Changes and general terms', p: [
    'We may update these terms. If a change matters, we will email the owners of your brands at least 30 days before it applies to paid plans. Continuing to use Mise after a change means you accept it.',
    'These terms are governed by the law of England and Wales, and the courts of England and Wales have exclusive jurisdiction.',
    `Questions: ${C.email}.`,
  ] },
];

export const PRIVACY: Section[] = [
  { h: 'Who we are', p: [
    `Mise is run by ${C.name} (company number ${C.number}), ${C.address} (“we”, “us”). For personal data about our customers and website visitors, we are the controller.`,
    'For personal data inside the content our customers put into Mise (for example, people in photos, or names in product data), our customer is the controller and we process it on their behalf.',
    `Contact us about privacy at ${C.email}.`,
  ] },
  { h: 'What we collect', p: [
    '- Account details: your name (if you give it), email address, and your Google profile basics if you sign in with Google.',
    '- Brand and team details: brand names, who is a member, invites and roles.',
    '- Billing details: handled by Stripe. We see the billing name, address, VAT number and the last four digits of the card, not the full card number.',
    '- Content: files and text you or your team add, and what Mise makes from them.',
    '- Usage: what you do in Mise (for example, uploads, searches and designs), device and browser details, IP address and logs, used to run, secure and improve the service.',
    '- Share and portal visits: when someone opens a link or portal, we record views and downloads for the brand that shared it, and, for portals that require sign-in, the visitor’s email.',
    '- Messages: anything you send us, such as feedback or emails.',
  ] },
  { h: 'How we use it, and why', p: [
    '- To provide Mise and keep it secure (contract, and our legitimate interest in a secure service).',
    '- To take payment and keep financial records (contract, and legal obligation).',
    '- To send service emails such as sign-in links, invites and billing notices (contract).',
    '- To understand and improve Mise, using usage data (legitimate interests).',
    '- To tell you about new features, only where you have agreed or where the law allows it for existing customers. You can opt out at any time.',
    'We do not sell personal data. We do not use your content to train AI models, and Mise does not use face recognition.',
  ] },
  { h: 'Who we share it with', p: [
    'We use these providers to run Mise. They act on our instructions under contracts that protect your data:',
    '- Supabase: database, file storage and sign-in (EU).',
    '- Railway: hosting the app (EU).',
    '- Stripe: payments (UK, EU and US).',
    '- Resend: sending email (EU).',
    '- Anthropic: AI for organising files, brand kits and designs (US).',
    '- Voyage AI: AI search (US).',
    '- Google (Gemini API): making new photos and video when you ask for them (US).',
    '- Cloudflare: DNS and network protection (global).',
    '- Google, Dropbox and Box: only when you choose to import files from them, or sign in with Google.',
    'We may also share data if the law requires it, to protect our rights or users, or as part of a sale or reorganisation of our business (with the same protections).',
  ] },
  { h: 'International transfers', p: [
    'Some providers are outside the UK. Where personal data leaves the UK, we rely on UK adequacy regulations or the UK International Data Transfer Agreement / Addendum to the EU Standard Contractual Clauses.',
  ] },
  { h: 'How long we keep it', p: [
    '- Account and content: while your account or brand is active. When deleted, content is removed from the live service within 30 days and from backups within a further 90 days.',
    '- Billing records: 6 years, as UK tax law requires.',
    '- Logs and usage data: up to 12 months.',
  ] },
  { h: 'Your rights', p: [
    'You can ask to see, correct, delete or receive a copy of your personal data, and to object to or restrict how we use it. Email us and we will respond within one month. If your data is in a customer’s content, we will pass your request to that customer.',
    'If you are unhappy with how we handle your data, please tell us. You can also complain to the Information Commissioner’s Office (ico.org.uk).',
  ] },
  { h: 'Cookies', p: [
    'The Mise app uses only essential cookies: to keep you signed in, and to remember when you have unlocked a passcode-protected link or portal. We do not use advertising cookies in the app.',
  ] },
  { h: 'Changes', p: [
    'We will update this policy when how we handle data changes, and tell customers by email about significant changes.',
  ] },
];

// Who processes data for Mise. Shared by the Security page and the DPA (and kept in step with PRIVACY).
export const SUBPROCESSORS: { name: string; what: string; where: string }[] = [
  { name: 'Supabase', what: 'Database, file storage and sign-in', where: 'EU (on AWS)' },
  { name: 'Railway', what: 'Hosting the app', where: 'EU' },
  { name: 'Cloudflare', what: 'DNS and network protection', where: 'Global' },
  { name: 'Stripe', what: 'Payments and invoices', where: 'UK, EU and US' },
  { name: 'Resend', what: 'Sending email (sign-in links, invites, notices)', where: 'EU' },
  { name: 'Anthropic', what: 'AI for organising files, search, brand kits and designs', where: 'US' },
  { name: 'Voyage AI', what: 'AI search (making files searchable by meaning)', where: 'US' },
  { name: 'Google (Gemini API)', what: 'Making new photos and video when you ask for them', where: 'US' },
];
const SUBS = SUBPROCESSORS.map((s) => `- ${s.name}: ${s.what} (${s.where}).`);

export const SECURITY: Section[] = [
  { h: 'At a glance', p: [
    '- Your files and data are stored in the EU.',
    '- Everything is encrypted in transit (TLS) and at rest (AES-256).',
    '- Every brand is walled off from every other at the database level, not just in the app.',
    '- Files are private. Every view and download goes through a link that expires within minutes, except files you choose to put into another tool through an integration (see below).',
    '- No passwords to leak: people sign in with Google or a one-time email link.',
    '- Your content is never used to train AI, and Mise never identifies people from their faces.',
    '- Enterprise adds roles (owner, admin, editor, contributor, viewer) and an activity log you can export.',
    `- A UK company working under UK GDPR, with a standard Data Processing Agreement at app.misedam.com/dpa.`,
  ] },
  { h: 'Where your data lives', p: [
    'The Mise app runs on Railway in the EU. Your database, files and sign-in run on Supabase in the EU, which is hosted on Amazon Web Services. Files are stored in a private storage bucket that can only be reached through Mise.',
    'Payments are handled by Stripe, which is certified to PCI DSS Level 1. Mise never sees or stores card numbers. Supabase and Stripe are independently audited (SOC 2 Type 2).',
  ] },
  { h: 'Encryption', p: [
    '- In transit: every connection to Mise, to share links and portals, and between Mise and its providers uses TLS (HTTPS).',
    '- At rest: the database, files and backups are encrypted with AES-256 by our hosting providers.',
    '- Passcodes for share links and portals are stored only as salted hashes (scrypt). Claude connector links are stored only as SHA-256 hashes, so even we can’t read them back.',
  ] },
  { h: 'Who can see what', p: [
    'Every brand (workspace) is isolated by row-level security in the database: each request is checked against the person’s membership of that brand, so one customer’s data can’t be read through another’s account, even by a bug in the app.',
    '- Your team: only people invited to a brand can see it. On Enterprise, roles control what each person can do, and the same rules apply in the app, through Claude and in the database.',
    '- People you share with: only the files in the links and portals you create, in the formats you allow. Links can have a passcode, an expiry date and downloads switched off, and can be turned off at any time. Portals can be limited to an invite list of emails or company domains, with visitors confirming their email.',
    '- Claude: only through a person’s own connector link, with that person’s role, and only in their brands. Links can be turned off instantly in Settings.',
    '- Connected tools (Pro and Enterprise): tools an admin connects in Settings › Integrations can show approved, available files in the Mise picker, only on the sites listed for that tool. A file picked there gets a permanent link that anyone with it can open, so the other tool can show it. The link always serves the current version and stops working when the file is archived, expires, goes obsolete or is deleted. Keys are stored only as hashes and can be turned off instantly.',
    'Share and portal pages are hidden from search engines, and their views and downloads are recorded for the brand that shared them.',
  ] },
  { h: 'Signing in', p: [
    'Mise has no passwords. People sign in with Google, or with a one-time link sent to their email that works once and expires after an hour. Sign-in is handled by Supabase Auth.',
    'Single sign-on with your identity provider (SAML: Okta, Microsoft Entra ID, Google Workspace) is on the Enterprise roadmap. Tell us if you need it.',
  ] },
  { h: 'AI and your content', p: [
    'Mise sends the content each feature needs, and only that, to its AI providers: Anthropic (Claude) to organise files, search and design; Google’s Gemini API for new photos and video; and Voyage AI to make files searchable by meaning. They process it under commercial terms that do not allow them to train their models on it.',
    '- Mise never identifies people from their faces.',
    '- AI suggestions never overwrite your team’s edits.',
    '- Photos and video that AI makes from scratch are drafts until a person approves them.',
  ] },
  { h: 'Our own access', p: [
    'Access to production systems is limited to the people who run Mise, protected by multi-factor authentication, and used only to operate the service, fix problems or help when you ask.',
    'We don’t look at your content unless you ask us to, or we need to in order to keep the service safe or meet a legal obligation.',
  ] },
  { h: 'Backups, retention and deletion', p: [
    'The database is backed up automatically every day, and each backup is kept for 7 days. Files are stored on Amazon S3 through Supabase Storage, which is designed for very high durability.',
    'Every edit to a file keeps the previous version, so changes can be undone.',
    'When a brand is deleted, its content is removed from the live service within 30 days and from backups within a further 90 days.',
  ] },
  { h: 'Activity log', p: [
    'On Enterprise, admins and owners see who added, approved, changed, deleted and shared what, plus changes to people, roles, the brand kit, product feeds and the plan, and can download it as CSV. Entries can’t be edited or removed. Activity is recorded on every plan, so it’s there from day one when a brand moves to Enterprise.',
  ] },
  { h: 'Incidents', p: [
    'If we become aware of a security incident that affects your data, we’ll tell the owners of the affected brands without undue delay, and within 48 hours, with what happened, what data was involved and what we’re doing about it. We’ll help you meet any obligations you have to notify others.',
  ] },
  { h: 'Software and vulnerabilities', p: [
    'Mise is built on maintained, widely used frameworks (Next.js, Postgres, Supabase) and its dependencies are kept up to date. Secrets are kept in our hosting provider’s encrypted settings, never in code.',
    `Found a security problem? Email ${COMPANY.email} with “Security” in the subject. We’ll reply within two working days and won’t take action against good-faith research.`,
    'Mise doesn’t hold its own SOC 2 or ISO 27001 certification yet. Our main providers do, and we’re happy to complete your security questionnaire.',
  ] },
  { h: 'Subprocessors', p: [
    'These providers process data for Mise, under contracts that protect it. We give customers 30 days’ notice before adding a new one (see the DPA).',
    ...SUBS,
    'Google, Dropbox and Box are only involved when you choose to import files from them or sign in with Google.',
  ] },
  { h: 'Your data, your control', p: [
    '- Export: download any file in its original format at any time. For a full export of a library, email us.',
    '- Delete: owners can delete a brand in Settings. To close your whole account, email us.',
    '- Data requests: we help you answer requests from the people in your content (access, correction, deletion).',
    `Questions, security questionnaires or a signed DPA: ${COMPANY.email}.`,
  ] },
];

export const DPA: Section[] = [
  { h: 'About this agreement', p: [
    `This Data Processing Agreement (“DPA”) is between ${C.name} (company number ${C.number}), ${C.address}, trading as ${C.trading} (“Mise”, “we”), and the customer that uses Mise (“you”). It forms part of the Mise Terms (app.misedam.com/terms) or your Enterprise contract (together, the “Agreement”), and applies whenever we process personal data on your behalf.`,
    'It is designed to meet Article 28 of the UK GDPR and, where it applies, the EU GDPR (together, “Data Protection Law”). If this DPA and the Agreement conflict about personal data, this DPA wins.',
    'You accept this DPA by using Mise under the Agreement. If you’d like a signed copy for your records, email us.',
  ] },
  { h: '1. Roles', p: [
    'For personal data in the content you and your team put into Mise (“Customer Personal Data”), you are the controller and Mise is your processor. For account, billing and usage data about the people who use Mise, Mise is a controller, as described in our Privacy Policy.',
  ] },
  { h: '2. What we process', p: [
    '- Subject matter: providing Mise, a brand asset library, under the Agreement.',
    '- Duration: for as long as you use Mise, and until deletion under section 9.',
    '- Nature and purpose: storing, organising (including with AI), searching, transforming, displaying and sharing your content, as you direct through Mise.',
    '- Types of personal data: whatever your content contains, for example images of people, names, job titles and contact details in files, product data or brand guidelines; and the email addresses of people you share with through invite-only portals.',
    '- Data subjects: people who appear in or are named in your content, such as models, staff, customers and partners; and recipients of your share links and portals.',
    '- Special category data: Mise isn’t designed for it, and you agree not to upload special category data unless you need to and have a lawful basis.',
  ] },
  { h: '3. Our obligations', p: [
    'We will:',
    '- process Customer Personal Data only on your documented instructions, which are the Agreement, this DPA and how you use Mise, unless the law requires otherwise (in which case we’ll tell you first, unless the law forbids it);',
    '- tell you if we think an instruction breaks Data Protection Law;',
    '- make sure everyone who processes Customer Personal Data for us is bound by confidentiality;',
    '- not use Customer Personal Data for any other purpose, including training AI models, and not sell it.',
  ] },
  { h: '4. Security', p: [
    'We maintain appropriate technical and organisational measures to protect Customer Personal Data, described on our Security page (app.misedam.com/security), including encryption in transit and at rest, database-level isolation between customers, access controls and backups. We may improve these measures over time, but won’t reduce the overall level of protection.',
  ] },
  { h: '5. Subprocessors', p: [
    'You authorise us to use the subprocessors listed on our Security page. These are the current ones:',
    ...SUBS,
    'We’ll give you at least 30 days’ notice by email before adding or replacing a subprocessor. If you object on reasonable data protection grounds, we’ll discuss it in good faith; if we can’t resolve it, you may end the affected service and we’ll refund any prepaid fees for the remaining period.',
    'We impose data protection terms on each subprocessor that are at least as protective as this DPA, and remain responsible for their performance.',
  ] },
  { h: '6. International transfers', p: [
    'Some subprocessors are outside the UK and the EEA. Where Customer Personal Data is transferred, we rely on adequacy regulations or decisions, or on the UK International Data Transfer Agreement, the UK Addendum to the EU Standard Contractual Clauses, or the EU Standard Contractual Clauses, as applicable.',
  ] },
  { h: '7. Helping you', p: [
    'Taking into account what we process and the information available to us, we’ll help you:',
    '- respond to requests from data subjects (Mise lets you find, edit, export and delete content yourself; we’ll pass on any request we receive directly);',
    '- carry out data protection impact assessments and consult regulators, where needed;',
    '- meet your security and breach notification obligations.',
  ] },
  { h: '8. Personal data breaches', p: [
    'We’ll notify you without undue delay, and within 48 hours of becoming aware, of a personal data breach affecting Customer Personal Data. We’ll tell you what we know (what happened, the data and people likely affected, likely consequences, and what we’re doing), update you as we learn more, and take reasonable steps to contain it.',
  ] },
  { h: '9. Deletion and return', p: [
    'You can export and delete your content in Mise at any time. When the Agreement ends, or a brand is deleted, we delete Customer Personal Data from the live service within 30 days and from backups within a further 90 days, unless the law requires us to keep it. On request before deletion, we’ll help you export your library.',
  ] },
  { h: '10. Audits', p: [
    'We’ll make available the information reasonably needed to show we comply with this DPA, including answering security questionnaires and providing our subprocessors’ audit reports where they allow it. If that isn’t enough, you (or an independent auditor bound by confidentiality) may audit our compliance once a year, with at least 30 days’ notice, during business hours, at your cost and without disrupting the service or other customers’ data.',
  ] },
  { h: '11. General', p: [
    'Each party’s liability under this DPA is subject to the limits in the Agreement. This DPA lasts as long as we process Customer Personal Data for you. It is governed by the law of England and Wales, and the courts of England and Wales have exclusive jurisdiction.',
    `Contact for anything in this DPA: ${COMPANY.email}.`,
  ] },
];
