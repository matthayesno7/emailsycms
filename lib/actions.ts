// Things to do with a picture you already have, on a Create board: resize for social, a new scene,
// new light, a clean background, translated words, a mock-up, a short clip, or any change in words.
// Safe for the browser. The server (lib/runAction.ts) runs them with Create's models and rules.

export type ActionId = 'resize' | 'scene' | 'light' | 'background' | 'translate' | 'mockup' | 'animate' | 'edit';
export type ActionDef = {
  id: ActionId; title: string; blurb: string;
  kind: 'resize' | 'image' | 'video';
  choices?: string[];          // pick one (chips)
  ask?: { label: string; placeholder: string };   // or describe it (free text); with choices, optional extra detail
  takes?: number;              // images per source photo
  designsPerTake?: number;     // what each image counts as (see lib/models.ts)
  batch: boolean;              // works on several selected images at once
};

// Sizes for "Resize for social": the same sizes Create designs for, cropped around the focal point.
export const SOCIAL_SIZES = [
  { id: 'ig-post', label: 'Instagram post', w: 1080, h: 1350 },
  { id: 'square', label: 'Square', w: 1080, h: 1080 },
  { id: 'story', label: 'Story', w: 1080, h: 1920 },
  { id: 'linkedin-post', label: 'LinkedIn post', w: 1200, h: 627 },
  { id: 'x-post', label: 'X post', w: 1600, h: 900 },
  { id: 'email-hero', label: 'Email hero', w: 1200, h: 600 },
] as const;

export const ACTIONS: ActionDef[] = [
  { id: 'resize', kind: 'resize', batch: true, title: 'Resize for social', blurb: 'Instagram, stories, LinkedIn, X and email sizes in one go, cropped around the focal point. No AI.' },
  { id: 'scene', kind: 'image', batch: true, takes: 2, designsPerTake: 1, title: 'New scene', blurb: 'The same product, exactly as it is, somewhere new.',
    choices: ['On a marble kitchen counter', 'On a sunny beach', 'In a cosy living room', 'On a city street at dusk', 'In a bright studio, brand colours'],
    ask: { label: 'Or describe the scene', placeholder: 'On a wooden table by a window, morning light' } },
  { id: 'light', kind: 'image', batch: true, takes: 2, designsPerTake: 1, title: 'Change the light or season', blurb: 'Same shot, new mood.',
    choices: ['Golden hour', 'Soft studio light', 'Night, neon', 'Overcast and moody', 'Summer', 'Autumn', 'Winter, snow', 'Festive'] },
  { id: 'background', kind: 'image', batch: true, takes: 2, designsPerTake: 1, title: 'Clean background', blurb: 'The subject on a simple background, ready for product pages and ads.',
    choices: ['Plain white', 'Brand colour', 'Soft grey studio', 'Soft shadow on white'] },
  { id: 'translate', kind: 'image', batch: true, takes: 1, designsPerTake: 2, title: 'Translate the words', blurb: 'Every word in the picture in another language, same layout.',
    choices: ['French', 'German', 'Spanish', 'Italian', 'Dutch', 'Portuguese', 'Swedish', 'Polish', 'Japanese', 'Arabic'] },
  { id: 'mockup', kind: 'image', batch: true, takes: 2, designsPerTake: 1, title: 'Mock it up', blurb: 'See it on a billboard, a phone or in a shop window.',
    choices: ['Billboard', 'Phone screen', 'Shop window', 'Magazine page', 'Bus shelter poster', 'Laptop screen'] },
  { id: 'animate', kind: 'video', batch: false, designsPerTake: 10, title: 'Animate', blurb: 'A short clip with sound, from this picture.',
    choices: ['Slow push-in', 'Gentle parallax', 'Product turntable', 'Light sweeping across'],
    ask: { label: 'Anything else? (optional)', placeholder: 'Steam rising from the cup, soft café sounds' } },
  // Whatever someone types with a picture selected. Not a chip: it's the board's text box.
  { id: 'edit', kind: 'image', batch: true, takes: 2, designsPerTake: 1, title: 'Change it with words', blurb: 'Say what should change.',
    ask: { label: 'What should change?', placeholder: 'Make it autumn, add steam to the coffee' } },
];
export const SUGGESTED = ACTIONS.filter((a) => a.id !== 'edit');

// ---------- board tools: the hands-on edits in a board's Tools menu (lib/boardTools.ts runs them) ----------
export type ToolId = 'removebg' | 'upscale' | 'erase' | 'extend' | 'smartresize' | 'readtext' | 'edittext';
// Smart resize: re-laid out with AI for each channel, not cropped.
export const SMART_SIZES = [
  { id: 'email-hero', label: 'Email hero', w: 1200, h: 600 },
  { id: 'ig-post', label: 'Instagram post', w: 1080, h: 1350 },
  { id: 'square', label: 'Square', w: 1080, h: 1080 },
  { id: 'story', label: 'Story or reel', w: 1080, h: 1920 },
  { id: 'linkedin-post', label: 'LinkedIn post', w: 1200, h: 627 },
  { id: 'linkedin-banner', label: 'LinkedIn banner', w: 1128, h: 191 },
  { id: 'x-post', label: 'X post', w: 1600, h: 900 },
  { id: 'pinterest', label: 'Pinterest pin', w: 1000, h: 1500 },
  { id: 'fb-cover', label: 'Facebook cover', w: 1640, h: 624 },
  { id: 'display-mpu', label: 'Display ad 300×250', w: 600, h: 500 },
] as const;
export const EXTEND_SHAPES = [
  { id: 'wide', label: 'Wider (16:9)', aspect: '16:9' },
  { id: 'tall', label: 'Taller (9:16)', aspect: '9:16' },
  { id: 'square', label: 'Square (1:1)', aspect: '1:1' },
  { id: 'portrait', label: 'Portrait (4:5)', aspect: '4:5' },
  { id: 'landscape', label: 'Landscape (3:2)', aspect: '3:2' },
] as const;
// What each tool counts as, in designs (Replicate tools count as one; AI edits as their model does).
export const TOOL_DESIGNS: Record<ToolId, number> = { removebg: 1, upscale: 1, erase: 1, extend: 1, smartresize: 1, readtext: 0, edittext: 2 };
export const actionById = (id: unknown) => ACTIONS.find((a) => a.id === id) || null;

// What one source photo costs in designs (shown on the button).
export const actionDesigns = (a: ActionDef) => (a.kind === 'resize' ? 0 : (a.takes || 1) * (a.designsPerTake || 1));

const KEEP = 'Keep the main subject and any product exactly as it is: same shape, colours, materials, label, logo and text. Photorealistic, natural, no extra text or watermarks.';

// The words sent to the model. choice: a chip; detail: what they typed. brandColour: the kit's primary colour, if any.
export function actionPrompt(id: ActionId, choice: string, detail: string, brandColour?: string | null) {
  const c = choice.trim(), d = detail.trim();
  switch (id) {
    case 'scene': return `Place the subject of the reference image in a new setting: ${d || c}. Match the lighting, perspective and shadows to the new setting. ${KEEP}`;
    case 'light': return `Re-light and restyle this exact photo for: ${c}${d ? ` (${d})` : ''}. Keep the composition, camera angle and framing the same; change only the light, colour grade, weather or seasonal details. ${KEEP}`;
    case 'background': {
      const bg = c === 'Brand colour' ? `a plain ${brandColour ? `${brandColour} ` : ''}brand-colour background` : c === 'Soft grey studio' ? 'a soft grey studio backdrop' : c === 'Soft shadow on white' ? 'a pure white background with a soft, natural contact shadow' : 'a pure white (#FFFFFF) background';
      return `Cut out the main subject of the reference image and place it on ${bg}, centred with comfortable space around it, as a clean product photo. ${KEEP}`;
    }
    case 'translate': return `Translate every piece of text in this image into ${c}. Keep everything else identical: layout, typefaces, sizes, colours, imagery and spacing. Use natural, correct ${c}, with the right characters and accents. Do not add or remove anything else.`;
    case 'mockup': return `A realistic photo of this exact image shown as a ${c.toLowerCase()} in a believable real-world setting. The image itself must appear unchanged, undistorted apart from natural perspective, and fully visible. ${d ? `${d}. ` : ''}No other branding.`;
    case 'animate': return `Animate this exact image: ${c}${d ? `. ${d}` : ''}. Subtle, smooth, premium motion; keep the subject, product, logo and any text unchanged and steady.`;
    case 'edit': return `Edit this image: ${d}. Change only what that asks for and keep everything else as it is. ${KEEP}`;
    default: return d || c;
  }
}
