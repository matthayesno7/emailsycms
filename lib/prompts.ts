// The prompt library: things marketers make with Claude + Emailsy + Figma, ready to copy.
// Shared by the Create page and the MCP server (prompts/list), so both stay the same.
// Placeholders: {brand} workspace name, {product} a product name, {pid} its PID,
// {image} an image name, {figma} the connected Figma file (or a note to paste one).

export type PromptUse = 'design' | 'ai-image' | 'ai-video' | 'motion' | 'copy';
export type PromptCategory = 'email' | 'social' | 'ads' | 'product' | 'video' | 'brand';

export type PromptExample = {
  id: string;
  category: PromptCategory;
  title: string;
  format: string; // channel and size, shown on the card
  uses: PromptUse[];
  prompt: string;
  needs?: ('product' | 'image' | 'logo' | 'kit')[];
};

export const CATEGORIES: [PromptCategory | 'all', string][] = [
  ['all', 'Everything'],
  ['email', 'Email'],
  ['social', 'Social'],
  ['ads', 'Ads'],
  ['product', 'Product shots'],
  ['video', 'Video & motion'],
  ['brand', 'Brand'],
];

export const USE_LABEL: Record<PromptUse, string> = {
  design: 'Figma design',
  'ai-image': 'AI image',
  'ai-video': 'AI video',
  motion: 'Figma motion',
  copy: 'Copy',
};

export const PROMPTS: PromptExample[] = [
  // ---------- email ----------
  { id: 'email-hero', category: 'email', title: 'Email hero banner', format: 'Email · 1200×600', uses: ['design'], needs: ['product'],
    prompt: 'Make an email hero banner for {brand} featuring {product}. 1200×600, on brand, with a short headline and a "Shop now" button. Keep the headline as live text in Figma, save the finished banner to Emailsy.' },
  { id: 'email-hero-ai', category: 'email', title: 'Hero with a new product scene', format: 'Email · 1200×600', uses: ['ai-image', 'design'], needs: ['product'],
    prompt: 'Create a new lifestyle scene for {product} (PID {pid}) for an email hero from {brand}: keep the real product exactly as it is and generate the setting around it, following our brand kit\'s imagery style. 1200×600. Show me the cost before you run the model, then save the result to Emailsy.' },
  { id: 'email-mobile-hero', category: 'email', title: 'Mobile-first hero', format: 'Email · 640×800', uses: ['design'], needs: ['image'],
    prompt: 'Turn "{image}" into a tall mobile email hero for {brand}, 640×800, with the focal point kept in frame and room for a headline at the top. Save it to Emailsy.' },
  { id: 'email-product-grid', category: 'email', title: 'Product grid, 4 up', format: 'Email · 2 × 2 cards', uses: ['design'], needs: ['product'],
    prompt: 'Build a 2×2 product grid for an email from {brand}, using four of our newest products from Emailsy (start with {product}). Each card: image, name, price, "Shop" button, from our design system in {figma}.' },
  { id: 'email-sale-banner', category: 'email', title: 'Sale announcement strip', format: 'Email · 1200×300', uses: ['design'],
    prompt: 'Design a slim sale banner for the top of an email from {brand}: "Up to 30% off, this weekend only". 1200×300, brand colours, bold and simple. Save it to Emailsy.' },
  { id: 'email-full-campaign', category: 'email', title: 'Full campaign email', format: 'Email · 600px wide', uses: ['design', 'copy'], needs: ['product'],
    prompt: 'Build a complete {brand} campaign email in {figma} launching {product}: hero, short intro, product feature, two supporting products, and footer. Use our design system components and brand kit, write the copy in our voice, and export-ready for Email Love.' },
  { id: 'email-countdown', category: 'email', title: 'Last-chance email visual', format: 'Email · 1200×600', uses: ['design'],
    prompt: 'Make a "Last chance: ends at midnight" hero for an email from {brand}, 1200×600, urgent but on brand, with space for a live countdown timer below. Save it to Emailsy.' },
  { id: 'email-footer', category: 'email', title: 'Email footer', format: 'Email block', uses: ['design'], needs: ['logo'],
    prompt: 'Build our email footer as a component in {figma}: {brand} logo, social icons, address line and unsubscribe link, using our brand kit.' },

  // ---------- social ----------
  { id: 'linkedin-banner', category: 'social', title: 'LinkedIn company banner', format: 'LinkedIn · 1128×191', uses: ['design'], needs: ['logo'],
    prompt: 'Design a LinkedIn company page banner for {brand}, 1128×191, with our logo and a one-line positioning statement. Keep the left side clear where the profile picture sits. Save it to Emailsy.' },
  { id: 'linkedin-post', category: 'social', title: 'LinkedIn post image', format: 'LinkedIn · 1200×627', uses: ['design', 'copy'],
    prompt: 'Make a LinkedIn post image for {brand} announcing our new season, 1200×627, plus the post copy (under 80 words). Save the image to Emailsy.' },
  { id: 'ig-post', category: 'social', title: 'Instagram post', format: 'Instagram · 1080×1350', uses: ['design'], needs: ['product'],
    prompt: 'Create an Instagram feed post for {brand} featuring {product}, 1080×1350, minimal text, on brand. Save it to Emailsy.' },
  { id: 'ig-story', category: 'social', title: 'Instagram story', format: 'Story · 1080×1920', uses: ['design'], needs: ['product'],
    prompt: 'Make an Instagram story for {brand} launching {product}, 1080×1920, with the product big in the middle, a short headline and space at the bottom for a link sticker. Save it to Emailsy.' },
  { id: 'social-set', category: 'social', title: 'One idea, every size', format: 'Post, story, LinkedIn, X', uses: ['design'], needs: ['image'],
    prompt: 'Take "{image}" and make a matching set for {brand}: Instagram post (1080×1350), story (1080×1920), LinkedIn (1200×627) and X (1600×900). Same headline, adapted to each shape. Save all four to Emailsy.' },
  { id: 'carousel', category: 'social', title: 'Carousel, 5 slides', format: 'Instagram / LinkedIn · 1080×1350', uses: ['design', 'copy'],
    prompt: 'Build a 5-slide carousel for {brand}: "5 ways to wear it" featuring {product}. 1080×1350 each, consistent layout, brand fonts and colours, a cover and a final call to action. Save each slide to Emailsy.' },
  { id: 'youtube-thumb', category: 'social', title: 'YouTube thumbnail', format: 'YouTube · 1280×720', uses: ['design'],
    prompt: 'Design a YouTube thumbnail for a {brand} video called "Behind the scenes: how it\'s made", 1280×720, bold readable text at small sizes. Save it to Emailsy.' },

  // ---------- ads ----------
  { id: 'meta-ads', category: 'ads', title: 'Meta ad variations', format: 'Facebook / Instagram · 1080×1080', uses: ['design', 'copy'], needs: ['product'],
    prompt: 'Make three Meta ad variations for {product} from {brand}, 1080×1080: one benefit-led, one price-led, one social-proof-led. Write the primary text and headline for each and save the images to Emailsy.' },
  { id: 'display-set', category: 'ads', title: 'Display ad set', format: '300×250, 728×90, 160×600', uses: ['design'], needs: ['product'],
    prompt: 'Create a Google display ad set for {brand} promoting {product}: 300×250, 728×90 and 160×600, with logo, product, short headline and button. Save all three to Emailsy.' },
  { id: 'retargeting', category: 'ads', title: 'Retargeting ad', format: 'Social · 1080×1080', uses: ['design'], needs: ['product'],
    prompt: 'Design a retargeting ad for people who viewed {product}: "Still thinking about it?" with the product image and price, 1080×1080, on brand. Save it to Emailsy.' },

  // ---------- product ----------
  { id: 'cutout', category: 'product', title: 'Clean product cut-out', format: 'PNG · transparent', uses: ['ai-image'], needs: ['product'],
    prompt: 'Remove the background from {product}\'s photo and save a clean transparent PNG to Emailsy. Keep the product edges crisp.' },
  { id: 'lifestyle', category: 'product', title: 'Lifestyle scene', format: 'Image · 1600×1200', uses: ['ai-image'], needs: ['product', 'kit'],
    prompt: 'Place {product} in a lifestyle scene that matches our brand kit\'s imagery style. Don\'t change the product itself. Give me three options with the cost first, then save the one I pick to Emailsy.' },
  { id: 'seasonal', category: 'product', title: 'Seasonal backdrop', format: 'Image · 1200×1200', uses: ['ai-image'], needs: ['product'],
    prompt: 'Put {product} on an autumn backdrop (warm light, leaves, wood) for {brand}, 1200×1200, product unchanged and in focus. Show me the cost first, then save it to Emailsy.' },
  { id: 'flatlay', category: 'product', title: 'Flat lay of a collection', format: 'Image · 1200×1200', uses: ['design'], needs: ['product'],
    prompt: 'Arrange four {brand} products (start with {product}) as a styled flat lay on a neutral background, 1200×1200, using their cut-outs from Emailsy. Save it to Emailsy.' },

  // ---------- video ----------
  { id: 'product-reel', category: 'video', title: 'Product reel', format: 'Reel · 1080×1920 · 6s', uses: ['ai-video'], needs: ['product'],
    prompt: 'Make a 6-second vertical video of {product} for {brand}: slow camera move, soft light, the product unchanged. Show me the cost before you run the video model, then save the MP4 to Emailsy.' },
  { id: 'animated-banner', category: 'video', title: 'Animated email banner', format: 'Email · 1200×600', uses: ['motion'], needs: ['product'],
    prompt: 'Design a {brand} email banner for {product} in {figma} and animate it: headline slides in, product fades up, button appears. Keep it under 4 seconds, export it as a video and save it to Emailsy.' },
  { id: 'launch-teaser', category: 'video', title: 'Launch teaser', format: 'Story · 1080×1920 · 10s', uses: ['motion', 'copy'], needs: ['logo'],
    prompt: 'Create a 10-second launch teaser for {brand} in {figma}: three short lines of text appearing one after another, then the logo. Brand colours and fonts. Export it as a video and save it to Emailsy.' },
  { id: 'kinetic-quote', category: 'video', title: 'Kinetic customer quote', format: 'Square · 1080×1080 · 8s', uses: ['motion'],
    prompt: 'Animate a customer review for {brand} ("Honestly the best thing I bought this year") as kinetic type in {figma}, 1080×1080, 8 seconds, ending on our logo. Export as a video and save it to Emailsy.' },

  // ---------- brand ----------
  { id: 'kit-figma', category: 'brand', title: 'Brand kit from Figma', format: 'Brand kit', uses: ['design'],
    prompt: 'Build the Emailsy brand kit for {brand} from our Figma design system: {figma}.' },
  { id: 'kit-check', category: 'brand', title: 'On-brand check', format: 'Review', uses: ['copy'], needs: ['kit'],
    prompt: 'Look at the drafts waiting in {brand}\'s Emailsy library and check each against our brand kit: colours, fonts, logo use and imagery rules. Tell me which to approve and what to fix.' },
  { id: 'presentation-cover', category: 'brand', title: 'Deck cover slide', format: 'Slide · 1920×1080', uses: ['design'], needs: ['logo'],
    prompt: 'Design a presentation cover slide for {brand}, 1920×1080, with our logo, a title "Autumn/Winter Campaign" and a brand photo from Emailsy. Save it to Emailsy.' },
];

export type Fill = { brand: string; product?: string | null; pid?: string | null; image?: string | null; figma?: string | null };

export function fillPrompt(p: string, f: Fill) {
  return p
    .replace(/ \(PID \{pid\}\)/g, f.pid ? ` (PID ${f.pid})` : '')
    .replace(/"\{image\}"/g, f.image ? `"${f.image}"` : 'our latest campaign image')
    .replace(/\{brand\}/g, f.brand || 'our brand')
    .replace(/\{product\}/g, f.product ? `"${f.product}"` : 'our best-selling product')
    .replace(/\{pid\}/g, f.pid || 'from Emailsy')
    .replace(/\{image\}/g, f.image || 'our latest campaign image')
    .replace(/\{figma\}/g, f.figma || 'our Figma file (paste the link)');
}

// Build a prompt from the composer on the Create page.
export const QUICK_FORMATS: [string, string][] = [
  ['Email hero, 1200×600', 'email hero banner, 1200×600'],
  ['LinkedIn banner, 1128×191', 'LinkedIn company banner, 1128×191'],
  ['LinkedIn post, 1200×627', 'LinkedIn post image, 1200×627'],
  ['Instagram post, 1080×1350', 'Instagram post, 1080×1350'],
  ['Story, 1080×1920', 'Instagram story, 1080×1920'],
  ['Ad, 1080×1080', 'square social ad, 1080×1080'],
  ['Product reel, 6s video', '6-second vertical product video, 1080×1920'],
  ['Animated banner', 'animated email banner, 1200×600, under 4 seconds'],
];
