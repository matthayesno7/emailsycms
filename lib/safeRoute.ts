// Route handlers that always answer with JSON: an unexpected error comes back as
// { error } with the reason (and is logged), instead of an empty 500 the page can't explain.
export function safe(tag: string, fn: (request: Request) => Promise<Response | undefined>) {
  return async (request: Request) => {
    try { return (await fn(request)) || Response.json({ error: 'No answer from Mise.' }, { status: 500 }); } catch (e: any) {
      console.error(`[${tag}]`, e);
      const why = String(e?.message || e || 'unknown error').replace(/\s+/g, ' ').slice(0, 200);
      return Response.json({ error: `Something went wrong on our side (${why}). Try again in a moment.`, code: 'server' }, { status: 500 });
    }
  };
}
