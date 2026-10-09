import { createClient } from '@/lib/supabase/server';
import { renderHtml, renderText } from '@/lib/emails/template';
import { proEmail, welcomeEmail } from '@/lib/emails/content';
import { sendEmail } from '@/lib/emails/send';

// Preview and test the welcome emails. Signed in as a Mise admin (ADMIN_EMAILS, default Matt's addresses):
//   /api/admin/emails?email=welcome            the welcome email (HTML)
//   /api/admin/emails?email=pro&format=text    welcome to Pro, plain text
//   /api/admin/emails?send=1                   sends both to matt@misedam.com (&to= one of the admin addresses)
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const admins = () => (process.env.ADMIN_EMAILS || 'matthayesno7@gmail.com,matt@misedam.com').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

export async function GET(request: Request) {
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user?.email || !admins().includes(user.email.toLowerCase())) return new Response('Not found', { status: 404 });
  const u = new URL(request.url);
  const name = u.searchParams.get('name') ?? 'Matt Hayes';
  const brand = u.searchParams.get('brand') || 'Oakhaus';
  const emails = { welcome: welcomeEmail({ name }), pro: proEmail({ name, brand }) };

  if (u.searchParams.get('send') === '1') {
    const to = (u.searchParams.get('to') || 'matt@misedam.com').toLowerCase();
    if (!admins().includes(to)) return Response.json({ error: 'Test emails only go to admin addresses.' }, { status: 400 });
    const welcome = await sendEmail(to, { ...emails.welcome, subject: `[Test] ${emails.welcome.subject}` }, 'test');
    const pro = await sendEmail(to, { ...emails.pro, subject: `[Test] ${emails.pro.subject}` }, 'test');
    return Response.json({ to, welcome, pro, from: process.env.WELCOME_FROM || 'Matt from Mise <matt@misedam.com>', note: welcome && pro ? 'Sent. Check the inbox (and spam).' : 'Not sent: see the server logs and Resend → Logs.' });
  }
  const e = emails[(u.searchParams.get('email') as 'welcome' | 'pro') || 'welcome'] || emails.welcome;
  if (u.searchParams.get('format') === 'text') return new Response(`Subject: ${e.subject}\nPreheader: ${e.preheader}\n\n${renderText(e)}`, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  return new Response(renderHtml(e), { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
