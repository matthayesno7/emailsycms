// Runs once when the server starts. Starts the product-feed sync (daily, Pro) and the auto-organise worker, which tags new and
// backfilled assets in the background (needs ANTHROPIC_API_KEY and SUPABASE_SERVICE_ROLE_KEY).
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NEXT_PHASE === 'phase-production-build') return;
  const { startTagWorker } = await import('./lib/autotagWorker');
  startTagWorker();
  const { startFeedWorker } = await import('./lib/feedSync');
  startFeedWorker();
}
