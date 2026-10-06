'use client';
import { useCallback, useEffect, useState } from 'react';
import { designAllowance, FREE_FILES, gbp, PRICE, type Billing, type Interval } from '@/lib/plans';
import type { Ws } from './Library';
import AutoOrganise from './AutoOrganise';

type State = {
  billing: Billing; role: string | null; stripe: boolean; trial_days: number;
  free: { files: number; files_max: number; studio_used: boolean };
  designs: { used: number; allowance: number; extra: number; extra_pence: number; extra_left: number; resets: string };
};

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '');

async function go(path: string, body: Record<string, any>, toast: (m: string) => void) {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
  const j = await r?.json().catch(() => ({}));
  if (r?.ok && j?.url) { location.href = j.url; return true; }
  toast(j?.error || 'Couldn’t reach billing. Try again in a moment.');
  return false;
}

// What Pro adds, said the same way as the pricing page.
const PRO_ADDS = [
  'Your whole library: unlimited files, every one organised and searchable',
  'Share links and brand portals',
  'Edit photos and designs, with every version kept',
  `${designAllowance('pro')} Studio designs a month, then ${gbp(PRICE.overage)} each up to a cap you set`,
  'Licence expiry dates, with expired files blocked automatically',
  'Mark files obsolete and point people to the replacement',
];

function Meter({ label, used, max }: { label: string; used: number; max: number }) {
  const pc = max ? Math.min(100, Math.round((used / max) * 100)) : 100;
  return (
    <div className={'usage-row' + (pc >= 100 ? ' full' : pc >= 80 ? ' near' : '')}>
      <span>{label}</span>
      <span className="usage-meter" aria-label={`${used} of ${max}`}><i style={{ width: `${pc}%` }} /></span>
      <span className="state">{Math.min(used, max).toLocaleString()} of {max.toLocaleString()}</span>
    </div>
  );
}

const priceLine = (i: Interval) => (i === 'year' ? `${gbp(PRICE.year)} a year per brand` : `${gbp(PRICE.month)} a month per brand`);

// Settings → Plan: this brand's plan, Studio designs this month, upgrade or manage billing.
export function PlanSettings({ ws, toast }: { ws: Ws; toast: (m: string) => void }) {
  const [s, setS] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [cap, setCap] = useState('');

  const load = useCallback(() => {
    fetch(`/api/billing?workspace_id=${ws.id}`).then((r) => (r.ok ? r.json() : null)).then((j) => {
      setS(j);
      if (j) setCap(String(Math.round(j.billing.overage_cap_pence / 100)));
    }).catch(() => {});
  }, [ws.id]);
  useEffect(() => { load(); }, [load]);

  if (!s) return <div className="settings"><h2>Plan</h2><p className="tip">Loading…</p></div>;
  const b = s.billing;
  const owner = s.role === 'owner';
  const pro = b.plan !== 'free';
  const d = s.designs;
  const pc = d.allowance ? Math.min(100, Math.round((Math.min(d.used, d.allowance) / d.allowance) * 100)) : 100;

  async function saveCap(e: React.FormEvent) {
    e.preventDefault();
    const pounds = Number(cap);
    if (!(pounds >= 0 && pounds <= 10000)) { toast('Enter an amount between £0 and £10,000.'); return; }
    setBusy(true);
    const r = await fetch('/api/billing', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspace_id: ws.id, overage_cap_pence: Math.round(pounds * 100) }) }).catch(() => null);
    setBusy(false);
    if (!r?.ok) { toast((await r?.json().catch(() => null))?.error || 'Couldn’t save the cap.'); return; }
    toast(pounds ? `Extra designs capped at ${gbp(Math.round(pounds * 100))} a month` : 'Extra designs switched off');
    load();
  }

  return (
    <div className="settings plan">
      <h2>Plan & usage</h2>

      <section className="plan-card">
        <div className="plan-head">
          <div>
            <div className="plan-name">{ws.name} is on <b>{pro ? 'Pro' : 'Free'}</b>{pro && b.status === 'trialing' && <span className="trial-tag">Trial</span>}</div>
            <p className="tip">
              {pro
                ? <>{b.interval === 'year' ? priceLine('year') : priceLine('month')}{b.current_period_end ? (b.cancel_at_period_end ? ` · ends ${day(b.current_period_end)}` : b.status === 'trialing' ? ` · trial ends ${day(b.current_period_end)}` : ` · renews ${day(b.current_period_end)}`) : ''}{b.status === 'past_due' ? ' · payment failed, Stripe is retrying' : ''}</>
                : 'A taster of Mise: your brand kit, up to 50 files and one Studio run. No card needed.'}
            </p>
          </div>
          {pro && owner && s.stripe && b.has_customer && (
            <button className="btn" type="button" disabled={busy} onClick={async () => { setBusy(true); if (!(await go('/api/billing/portal', { workspace_id: ws.id }, toast))) setBusy(false); }}>Manage billing</button>
          )}
        </div>

        <div className="usage-grid">
          {!pro ? (
            <>
              <Meter label="Files" used={s.free.files} max={s.free.files_max} />
              <div className="usage-row"><span>Studio run</span><span className={'state ' + (s.free.studio_used ? 'used' : 'ok')}>{s.free.studio_used ? 'Used' : 'Available'}</span></div>
              <div className="usage-row"><span>Sharing and editing</span><span className="state locked">On Pro</span></div>
            </>
          ) : (
            <>
              <div className="usage-row"><span>Files</span><span className="state ok">{s.free.files.toLocaleString()} · unlimited</span></div>
              <Meter label="Studio designs this month" used={Math.min(d.used, d.allowance)} max={d.allowance} />
              {d.extra > 0 && <div className="usage-row"><span>Extra designs</span><span className="state">{d.extra} · {gbp(d.extra_pence)} on the next invoice</span></div>}
            </>
          )}
        </div>
        {pro && <p className="tip">Studio designs reset on {day(d.resets)}.</p>}
      </section>

      {!pro && (
        <section className="plan-upgrade">
          <div className="pu-head">
            <h3>Pro</h3>
            <span className="pu-price"><b>{gbp(PRICE.month)}</b> / month per brand{s.trial_days ? <span className="trial-pill">{s.trial_days}-day free trial</span> : null}</span>
          </div>
          <ul className="upsell-list">{PRO_ADDS.map((t) => <li key={t}>{t}</li>)}</ul>
          {!s.stripe ? <p className="tip">Billing isn’t switched on yet.</p>
            : !owner ? <p className="tip">Ask an owner of {ws.name} to upgrade it.</p>
            : (
              <div className="plan-actions">
                <button className="primary" type="button" onClick={() => openUpgrade({ reason: 'general' })}>{s.trial_days ? `Start ${s.trial_days}-day free trial` : `Upgrade ${ws.name}`}</button>
                <p className="tip">or {gbp(PRICE.year)} a year (2 months free). Plus VAT. Cancel any time.</p>
              </div>
            )}
        </section>
      )}

      {pro && (
        <form className="plan-sec" onSubmit={saveCap}>
          <h3>Extra Studio designs</h3>
          <div className="row-inline">
            <label htmlFor="cap" className="tip">Monthly cap</label>
            <span className="prefix">£</span>
            <input id="cap" className="in short" type="number" min={0} max={10000} step={1} value={cap} disabled={!owner} onChange={(e) => setCap(e.target.value)} />
            {owner && <button className="btn" type="submit" disabled={busy}>Save</button>}
          </div>
          <p className="tip">After {d.allowance} designs a month, each extra one is {gbp(PRICE.overage)}. Studio pauses at the cap; £0 switches extras off.{d.extra_left > 0 ? ` ${d.extra_left} more fit this month.` : ''}</p>
        </form>
      )}

      <AutoOrganise ws={ws.id} toast={toast} />
    </div>
  );
}

// ---------- the upgrade pop-up ----------
// One plan, one button, opened right where the free plan holds something back.
export type UpgradeReason = 'portal' | 'files' | 'studio' | 'share' | 'edit' | 'organise' | 'designs' | 'media' | 'lifecycle' | 'brand' | 'general';
export type UpgradeAsk = { reason: UpgradeReason; count?: number; brand?: string };

// Anything in the app can ask for it: the app shell listens and opens the pop-up.
export function openUpgrade(ask: UpgradeAsk) {
  window.dispatchEvent(new CustomEvent('mise:upgrade', { detail: ask }));
}

const nextFirst = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 1).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }); };

function pitch(ask: UpgradeAsk, wsName: string) {
  switch (ask.reason) {
    case 'files': return { h: 'Bring in the rest of your library', p: `You’ve tried Mise with ${FREE_FILES} files${ask.count ? `; ${ask.count.toLocaleString()} more ${ask.count === 1 ? 'is' : 'are'} waiting to come in` : ''}. Pro takes your whole library, every file organised and searchable the moment it’s added.` };
    case 'studio': return { h: 'Keep creating', p: `That was your free Studio run. Pro gives you ${designAllowance('pro')} designs a month, on brand every time, then ${gbp(PRICE.overage)} each up to a cap you set.` };
    case 'portal': return { h: 'Publish your brand portal', p: 'Your portal is built and styled from your brand kit. Publish it to give agencies, retailers and partners one place for your logos, images and guidelines, and see who downloads what.' };
    case 'share': return { h: 'Share with your team, agencies and retailers', p: 'Send links to files, folders and collections, and publish a brand portal styled from your brand kit. See who viewed and downloaded what.' };
    case 'edit': return { h: 'Edit without leaving Mise', p: 'Crop, resize and retouch photos, change Studio designs, ask Claude to edit in Figma, and restore any earlier version.' };
    case 'organise': return { h: 'Organise your whole library today', p: `${ask.count ? `${ask.count.toLocaleString()} file${ask.count === 1 ? ' is' : 's are'}` : 'Some files are'} uploaded but waiting to be organised. On Pro, every file is tagged, described and searchable the moment it’s added. On Free, they carry on from ${nextFirst()}.` };
    case 'media': return { h: 'Make new photos and video', p: `New photography and video, made in your brand’s style with the best AI model for each job, are on Pro. Pro gives you ${designAllowance('pro')} designs a month: a photo is 1, a video clip is 10.` };
    case 'designs': return { h: 'Keep designing', p: `${wsName} has used this month’s ${designAllowance('free')} Studio designs. Pro gives you ${designAllowance('pro')} a month, then ${gbp(PRICE.overage)} each up to a cap you set. On Free, Studio comes back on ${nextFirst()}.` };
    case 'lifecycle': return { h: 'Never use an expired image again', p: 'Add the date a photo’s licence runs out and Mise blocks it on the day: no downloads, no shares, not offered to Studio or Claude. Mark old files obsolete and point people to the replacement.' };
    case 'brand': return { h: `Add ${ask.brand || 'another brand'}`, p: 'Your free plan covers one brand. Each extra brand gets its own library, brand kit, portals and Studio designs.' };
    default: return { h: 'Get your whole brand working', p: 'Everything in Free, without the waiting.' };
  }
}

const PRO_CARD = [
  'Your whole library: unlimited files, every one organised and searchable',
  'Share links and brand portals, with views and downloads',
  'Edit photos and designs, with every version kept',
  `${designAllowance('pro')} Studio designs a month, then ${gbp(PRICE.overage)} each`,
  'Licence expiry dates, with expired files blocked automatically',
  'Unlimited users, no seat fees',
];

export function UpgradeModal({ ws, ask, onClose, toast }: { ws: Ws; ask: UpgradeAsk; onClose: () => void; toast: (m: string) => void }) {
  const [info, setInfo] = useState<{ role: string | null; stripe: boolean; trial_days: number; plan: string } | null>(null);
  const [interval, setPeriod] = useState<Interval>('month');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch(`/api/billing?workspace_id=${ws.id}`).then((r) => (r.ok ? r.json() : null))
      .then((j) => setInfo(j ? { role: j.role, stripe: j.stripe, trial_days: ask.reason === 'brand' ? j.trial_days_new_brand ?? 7 : j.trial_days ?? 0, plan: j.billing?.plan } : { role: null, stripe: false, trial_days: 0, plan: 'free' }))
      .catch(() => setInfo({ role: null, stripe: false, trial_days: 0, plan: 'free' }));
  }, [ws.id, ask.reason]);
  const t = pitch(ask, ws.name);
  const newBrand = ask.reason === 'brand';
  const canBuy = !!info?.stripe && (newBrand || info.role === 'owner') && (newBrand || info.plan === 'free');
  const trial = info?.trial_days || 0;

  async function start() {
    setBusy(true);
    const ok = await go('/api/billing/checkout', newBrand ? { new_brand_name: ask.brand || 'New brand', interval } : { workspace_id: ws.id, interval }, toast);
    if (!ok) setBusy(false);
  }

  return (
    <div className="upsell">
      <div className="upsell-brand"><span className="dot" aria-hidden />Mise Pro<span className="muted"> · per brand</span></div>
      <h2>{t.h}</h2>
      <p className="upsell-lede">{t.p}</p>
      <div className="upsell-card">
        <div className="upsell-price">
          <b>{interval === 'year' ? gbp(PRICE.year) : gbp(PRICE.month)}</b>
          <span>/ {interval === 'year' ? 'year' : 'month'}</span>
          {trial > 0 && <span className="trial-pill">{trial}-day free trial</span>}
        </div>
        <p className="upsell-sub">
          {newBrand ? `For ${ask.brand || 'your new brand'}` : `For ${ws.name}`} · plus VAT · cancel any time ·{' '}
          <button type="button" className="linkish" onClick={() => setPeriod(interval === 'year' ? 'month' : 'year')}>
            {interval === 'year' ? `or ${gbp(PRICE.month)} a month` : `or ${gbp(PRICE.year)} a year (2 months free)`}
          </button>
        </p>
        <ul className="upsell-list">{PRO_CARD.map((f) => <li key={f}>{f}</li>)}</ul>
      </div>
      {!info ? <button className="primary wide" type="button" disabled>Loading…</button>
        : canBuy ? (
          <>
            <button className="primary wide" type="button" disabled={busy} onClick={start}>{busy ? 'Opening checkout…' : trial ? `Start ${trial}-day free trial` : 'Upgrade to Pro'}</button>
            <p className="upsell-fine">{trial ? `You won’t be charged today. After ${trial} days it’s ${interval === 'year' ? `${gbp(PRICE.year)} a year` : `${gbp(PRICE.month)} a month`} unless you cancel; cancel and you’re back on Free with all your files.` : 'Secure checkout with Stripe.'} By continuing you agree to the <a href="/terms" target="_blank">Terms</a>.</p>
          </>
        ) : !info.stripe ? <p className="tip">Billing isn’t switched on yet.</p>
        : info.plan !== 'free' && !newBrand ? <p className="tip">{ws.name} is already on Pro.</p>
        : <p className="tip">Ask an owner of {ws.name} to upgrade it.</p>}
      <button className="btn quiet wide" type="button" onClick={onClose}>{newBrand ? 'Not now' : 'Stay on Free'}</button>
    </div>
  );
}
