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
    'Free: you can try Mise without a card, within the limits shown in the app (currently a brand kit, up to 50 files and one Studio run per brand). We may change what Free includes.',
    'Pro: per brand, charged when you upgrade, plus VAT or sales tax where it applies. In the UK it is £149 a month or £1,490 a year; elsewhere it is US$199 a month or US$1,990 a year. Pro brands get 200 Studio designs a month; each design beyond that costs 50p (60¢ in US dollars), up to a monthly cap the brand’s owner sets, and is billed in arrears on the next invoice. A brand keeps the currency it first paid in.',
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
    'Our Privacy Policy explains how we handle personal data. Where we process personal data in your content on your behalf, we do so as your processor, following your instructions and the data processing terms available on request (and included in Enterprise contracts).',
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
    '- Anthropic: AI for organising files, brand kits and Studio designs (US).',
    '- Voyage AI: AI search (US).',
    '- Google (Gemini API): making new images when you ask for them (US).',
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
