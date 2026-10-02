'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  // Invite emails land here with tokens in the URL hash; turn them into a session.
  useEffect(() => {
    const h = new URLSearchParams(window.location.hash.slice(1));
    // A used or expired link comes back here with an error: say so, rather than a silent sign-in page.
    if (new URLSearchParams(window.location.search).get('error') === 'link' || h.get('error')) {
      setError(h.get('error_code') === 'otp_expired'
        ? 'That sign-in link has expired or was already used. Links work once, for an hour. Send yourself a new one.'
        : 'That sign-in link didn’t work. Send yourself a new one, or continue with Google.');
      setState('error');
      window.history.replaceState(null, '', '/login');
      return;
    }
    const access_token = h.get('access_token'), refresh_token = h.get('refresh_token');
    if (!access_token || !refresh_token) return;
    setState('sending');
    const supabase = createClient();
    supabase.auth.setSession({ access_token, refresh_token }).then(({ error }) => {
      if (error) { setError(error.message); setState('error'); return; }
      window.location.replace('/');
    });
  }, []);

  // Sign in with Google: no email needed, so no waiting on (or rate limits for) sign-in links.
  async function google() {
    setState('sending');
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/auth/callback` } });
    if (error) { setError(/provider is not enabled|Unsupported provider/i.test(error.message) ? 'Google sign-in isn’t switched on yet. Use an email link for now.' : error.message); setState('error'); }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState('sending');
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setError(error.message);
      setState('error');
    } else setState('sent');
  }

  return (
    <main className="auth">
      <div className="auth-card">
        <div className="org">
          <span className="logo"><Mark /></span>Mise
        </div>
        {state === 'sent' ? (
          <>
            <h1>Check your inbox</h1>
            <p className="tip">We sent a sign-in link to <b>{email}</b>. Open it on this device to continue.</p>
            <button className="btn quiet" type="button" onClick={() => setState('idle')}>Use a different email</button>
          </>
        ) : (
          <form onSubmit={submit}>
            <h1>Sign in</h1>
            <p className="tip">Your brand&apos;s assets in one place, ready to use and make with.</p>
            <button className="btn wide google" type="button" onClick={google} disabled={state === 'sending'}>
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
              Continue with Google
            </button>
            <div className="or"><span>or get a link by email</span></div>
            <label className="bl" htmlFor="email"><span>Work email</span></label>
            <input id="email" className="in" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
            {state === 'error' && <p className="err">{error}</p>}
            <button className="primary wide" type="submit" disabled={state === 'sending'}>
              {state === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

function Mark() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.6" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" />
    </svg>
  );
}
