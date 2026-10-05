'use client';
import { useCallback, useEffect, useState } from 'react';
import { designAllowance, gbp, PRICE, type Billing, type Interval } from '@/lib/plans';
import type { Ws } from './Library';

type State = {
  billing: Billing; role: string | null; stripe: boolean; trial_days: number;
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
  'Every file organised as soon as it’s added (Free does 500 a month)',
  `${designAllowance('pro')} Studio designs a month, then ${gbp(PRICE.overage)} each up to a cap you set`,
  'Unlimited portals and share links, no Mise badge',
  'Licence expiry dates, with expired files blocked automatically',
  'Mark files obsolete and point people to the replacement',
];

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
      <h2>Plan</h2>

      <div className="plan-card">
        <div className="plan-head">
          <div>
            <div className="plan-name">{ws.name} is on <b>{pro ? 'Pro' : 'Free'}</b></div>
            <p className="tip">
              {pro
                ? <>{b.interval === 'year' ? priceLine('year') : priceLine('month')}{b.current_period_end ? (b.cancel_at_period_end ? ` · ends ${day(b.current_period_end)}` : ` · renews ${day(b.current_period_end)}`) : ''}{b.status === 'past_due' ? ' · payment failed, Stripe is retrying' : ''}</>
                : 'One brand, unlimited users, files and storage. No card needed.'}
            </p>
          </div>
          {pro && owner && s.stripe && b.has_customer && (
            <button className="btn" type="button" disabled={busy} onClick={async () => { setBusy(true); if (!(await go('/api/billing/portal', { workspace_id: ws.id }, toast))) setBusy(false); }}>Manage billing</button>
          )}
        </div>

        <div className="plan-usage">
          <div className="ao-urow">
            <span>Studio designs this month</span>
            <div className="ao-meter small" aria-label={`${pc}% of the allowance used`}><i style={{ width: `${pc}%` }} /></div>
            <span className="muted">{Math.min(d.used, d.allowance)} of {d.allowance}</span>
          </div>
          {pro && d.extra > 0 && <p className="tip">Plus <b>{d.extra}</b> extra design{d.extra === 1 ? '' : 's'} ({gbp(d.extra_pence)}), on the next invoice.</p>}
          <p className="tip">Resets on {day(d.resets)}. Files, storage, organising and search are unlimited on every plan.</p>
        </div>
      </div>

      {pro && (
        <form className="bf" onSubmit={saveCap}>
          <div className="bl"><label htmlFor="cap">Monthly cap for extra designs</label></div>
          <div className="row-inline">
            <span className="prefix">£</span>
            <input id="cap" className="in short" type="number" min={0} max={10000} step={1} value={cap} disabled={!owner} onChange={(e) => setCap(e.target.value)} />
            {owner && <button className="btn" type="submit" disabled={busy}>Save</button>}
          </div>
          <p className="tip">After {d.allowance} designs, each extra one is {gbp(PRICE.overage)}. Studio pauses when this cap is reached; £0 switches extras off. {d.extra_left > 0 ? `${d.extra_left} more extra designs fit this month.` : ''}</p>
        </form>
      )}

      {!pro && (
        <div className="plan-upgrade">
          <h3>Pro</h3>
          <ul>{PRO_ADDS.map((t) => <li key={t}>{t}</li>)}</ul>
          {!s.stripe ? <p className="tip">Billing isn’t switched on yet.</p>
            : !owner ? <p className="tip">Ask an owner of {ws.name} to upgrade it.</p>
            : (
              <div className="plan-actions">
                <button className="primary" type="button" onClick={() => openUpgrade({ reason: 'general' })}>{s.trial_days ? `Start ${s.trial_days}-day free trial` : `Upgrade ${ws.name}`}</button>
                <p className="tip">{priceLine('month')} or {gbp(PRICE.year)} a year, plus VAT. Cancel any time.</p>
              </div>
            )}
        </div>
      )}
    </div>
  );
}

// ---------- the upgrade pop-up ----------
// One plan, one button, opened right where the free plan holds something back.
export type UpgradeReason = 'organise' | 'designs' | 'lifecycle' | 'brand' | 'general';
export type UpgradeAsk = { reason: UpgradeReason; count?: number; brand?: string };

// Anything in the app can ask for it: the app shell listens and opens the pop-up.
export function openUpgrade(ask: UpgradeAsk) {
  window.dispatchEvent(new CustomEvent('mise:upgrade', { detail: ask }));
}

const nextFirst = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 1).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }); };

function pitch(ask: UpgradeAsk, wsName: string) {
  switch (ask.reason) {
    case 'organise': return { h: 'Organise your whole library today', p: `${ask.count ? `${ask.count.toLocaleString()} file${ask.count === 1 ? ' is' : 's are'}` : 'Some files are'} uploaded but waiting to be organised. On Pro, every file is tagged, described and searchable the moment it’s added. On Free, they carry on from ${nextFirst()}.` };
    case 'designs': return { h: 'Keep designing', p: `${wsName} has used this month’s ${designAllowance('free')} Studio designs. Pro gives you ${designAllowance('pro')} a month, then ${gbp(PRICE.overage)} each up to a cap you set. On Free, Studio comes back on ${nextFirst()}.` };
    case 'lifecycle': return { h: 'Never use an expired image again', p: 'Add the date a photo’s licence runs out and Mise blocks it on the day: no downloads, no shares, not offered to Studio or Claude. Mark old files obsolete and point people to the replacement.' };
    case 'brand': return { h: `Add ${ask.brand || 'another brand'}`, p: 'Your free plan covers one brand. Each extra brand gets its own library, brand kit, portals and Studio designs.' };
    default: return { h: 'Get your whole brand working', p: 'Everything in Free, without the waiting.' };
  }
}

const PRO_CARD = [
  'Unlimited files and storage, every file organised as it’s added',
  `${designAllowance('pro')} Studio designs a month, then ${gbp(PRICE.overage)} each`,
  'Licence expiry dates, with expired files blocked automatically',
  'Obsolete files that point to their replacement',
  'Unlimited portals and share links, no Mise badge',
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
            <p className="upsell-fine">{trial ? `You won’t be charged today. After ${trial} days it’s ${interval === 'year' ? `${gbp(PRICE.year)} a year` : `${gbp(PRICE.month)} a month`} unless you cancel; cancel and you’re back on Free with all your files.` : 'Secure checkout with Stripe.'}</p>
          </>
        ) : !info.stripe ? <p className="tip">Billing isn’t switched on yet.</p>
        : info.plan !== 'free' && !newBrand ? <p className="tip">{ws.name} is already on Pro.</p>
        : <p className="tip">Ask an owner of {ws.name} to upgrade it.</p>}
      <button className="btn quiet wide" type="button" onClick={onClose}>{newBrand ? 'Not now' : 'Stay on Free'}</button>
    </div>
  );
}
