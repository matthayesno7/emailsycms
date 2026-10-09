// Mise's welcome emails, sent through Resend. Nothing here may block or break sign-up or checkout:
// every entry point catches and logs, and callers don't wait for it.
// Env: RESEND_API_KEY (already set for alerts). Optional: WELCOME_FROM (default "Matt from Mise <matt@misedam.com>"),
// WELCOME_REPLY_TO (default matt@misedam.com), SIGNUP_ALERT_EMAIL (default matthayesno7@gmail.com).
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '../supabase/admin';
import { notify } from '../notify';
import { renderHtml, renderText, type Email } from './template';
import { proEmail, welcomeEmail } from './content';

const FROM = () => process.env.WELCOME_FROM || 'Matt from Mise <matt@misedam.com>';
const REPLY_TO = () => process.env.WELCOME_REPLY_TO || 'matt@misedam.com';
const SIGNUP_ALERT = () => process.env.SIGNUP_ALERT_EMAIL || 'matthayesno7@gmail.com';

export async function sendEmail(to: string, e: Email, tag: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.log(`[emails] no RESEND_API_KEY; would send "${e.subject}" to ${to}`); return false; }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ from: FROM(), to: [to], reply_to: REPLY_TO(), subject: e.subject, html: renderHtml(e), text: renderText(e), tags: [{ name: 'email', value: tag }] }),
    });
    if (!res.ok) { console.error('[emails] Resend', tag, res.status, await res.text().catch(() => '')); return false; }
    return true;
  } catch (err: any) {
    console.error('[emails] Resend', tag, err?.message);
    return false;
  }
}

const nameOf = (u: any) => u?.user_metadata?.full_name || u?.user_metadata?.name || u?.user_metadata?.given_name || null;

// Email 1, and a note to Matt about the new sign-up. Called after every sign-in; does something only the
// first time a new account (created in the last two days) comes in. People who joined through a team
// invite don't get the welcome (they didn't sign up for Mise themselves); Matt hears about them anyway.
export async function onSignIn(userId: string, country?: string | null) {
  try {
    const db = createAdminClient();
    const { data: claimed } = await db.from('profiles').update({ signup_handled_at: new Date().toISOString() })
      .eq('id', userId).is('signup_handled_at', null).select('id, email, created_at');
    if (!claimed?.length) return;
    const { data: { user } } = await db.auth.admin.getUserById(userId);
    if (!user?.email || Date.now() - Date.parse(user.created_at) > 2 * 864e5) return;

    // Their own brand (one they created) means they signed up themselves; otherwise they came in on an invite.
    const { data: own } = await db.from('workspaces').select('id, name').eq('created_by', userId).order('created_at').limit(1);
    const { data: joined } = await db.from('workspace_members').select('role, workspaces(name)').eq('user_id', userId).limit(5);
    const invitedTo = (joined || []).map((m: any) => m.workspaces?.name).filter(Boolean);
    const name = nameOf(user);
    const via = user.app_metadata?.provider === 'google' ? 'Google' : 'email link';

    let welcomed = false;
    if (own?.length) {
      welcomed = await sendEmail(user.email, welcomeEmail({ name }), 'welcome');
      if (welcomed) await db.from('profiles').update({ welcome_sent_at: new Date().toISOString() }).eq('id', userId);
    }
    void notify(`Mise: new sign-up, ${user.email}`, [
      `${name ? `${name} <${user.email}>` : user.email} just signed up (${via}${country ? `, ${country}` : ''}).`,
      own?.length ? `Their brand: ${own[0].name}.` : `Joined through an invite to: ${invitedTo.join(', ') || 'a brand'}. No welcome email (invited).`,
      own?.length ? (welcomed ? 'Welcome email sent.' : 'Welcome email NOT sent (check the logs / Resend).') : '',
    ].filter(Boolean).join('\n'), { to: SIGNUP_ALERT(), replyTo: user.email });
  } catch (e: any) {
    console.error('[emails] sign-up', userId, e?.message);
  }
}

// Email 2: once per brand, when its Pro subscription is confirmed (Stripe webhook), to the owner who paid.
export async function onProConfirmed(db: SupabaseClient, ws: string, payer: { userId?: string | null; email?: string | null }) {
  try {
    const { data: claimed } = await db.from('workspace_billing').update({ pro_welcome_sent_at: new Date().toISOString() })
      .eq('workspace_id', ws).is('pro_welcome_sent_at', null).neq('plan', 'free').select('workspace_id');
    if (!claimed?.length) return;
    const { data: w } = await db.from('workspaces').select('name').eq('id', ws).maybeSingle();
    let email = payer.email || null, name: string | null = null;
    // Who paid: Checkout says; from a subscription event alone, the brand's (first) owner, who is the one who can pay.
    if (!payer.userId) {
      const { data: o } = await db.from('workspace_members').select('user_id').eq('workspace_id', ws).eq('role', 'owner').limit(1);
      payer = { ...payer, userId: o?.[0]?.user_id || null };
    }
    if (payer.userId) {
      const { data: { user } } = await db.auth.admin.getUserById(payer.userId);
      if (user) { email = user.email || email; name = nameOf(user); }
    }
    const ok = email ? await sendEmail(email, proEmail({ name, brand: w?.name || 'your brand' }), 'welcome_pro') : false;
    // Not sent (no address, or Resend failed): let the next webhook delivery try again.
    if (!ok) await db.from('workspace_billing').update({ pro_welcome_sent_at: null }).eq('workspace_id', ws);
  } catch (e: any) {
    console.error('[emails] pro', ws, e?.message);
  }
}
