// Features that are built but switched off in the live app until they're ready.
// Create (designs, photos, video, boards) is off unless NEXT_PUBLIC_MISE_CREATE=on.
// NEXT_PUBLIC_ so the browser sees it too; it's read at build time, so set it on Railway
// (or in .env.local for local dev) and redeploy to turn Create back on.
export const CREATE_ON = process.env.NEXT_PUBLIC_MISE_CREATE === 'on';

// Server side: Create's API routes answer 404 while Create is off, so it can't be reached
// by calling the API directly either. Returns null when Create is on.
export const createOff = () => (CREATE_ON ? null : Response.json({ error: 'Create isn’t available yet.' }, { status: 404 }));
