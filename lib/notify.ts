// Emails to the Mise team (alerts, feedback) through Resend's API.
// Needs RESEND_API_KEY and ALERT_EMAIL; MAIL_FROM defaults to Resend's test sender.
// Without them it logs instead, so nothing breaks.
export async function notify(subject: string, text: string, opts: { replyTo?: string; to?: string } = {}) {
  const key = process.env.RESEND_API_KEY, to = opts.to || process.env.ALERT_EMAIL;
  if (!key || !to) { console.log('[notify]', subject, '\n' + text); return false; }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        from: process.env.MAIL_FROM || 'Mise <onboarding@resend.dev>',
        to: to.split(',').map((s) => s.trim()).filter(Boolean),
        subject: subject.slice(0, 200), text,
        ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
      }),
    });
    if (!res.ok) console.error('[notify] Resend', res.status, await res.text().catch(() => ''));
    return res.ok;
  } catch (e: any) {
    console.error('[notify]', e?.message);
    return false;
  }
}
