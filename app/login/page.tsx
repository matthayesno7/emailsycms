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
    const access_token = h.get('access_token'), refresh_token = h.get('refresh_token');
    if (!access_token || !refresh_token) return;
    setState('sending');
    const supabase = createClient();
    supabase.auth.setSession({ access_token, refresh_token }).then(({ error }) => {
      if (error) { setError(error.message); setState('error'); return; }
      window.location.replace('/');
    });
  }, []);

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
          <span className="logo"><Mark /></span>Emailsy <span className="plan">CMS</span>
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
            <p className="tip">Email-ready images, logos, products and blocks for your emails. We&apos;ll email you a sign-in link.</p>
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
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  );
}
