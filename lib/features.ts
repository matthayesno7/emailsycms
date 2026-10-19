// Features that are built but switched off in the live app until they're ready.
// Create (designs, photos, video, boards) is off unless NEXT_PUBLIC_MISE_CREATE=on.
// NEXT_PUBLIC_ so the browser sees it too; it's read at build time, so set it on Railway
// (or in .env.local for local dev) and redeploy to turn Create back on.
export const CREATE_ON = process.env.NEXT_PUBLIC_MISE_CREATE === 'on';
