'use client';
import { useCallback, useEffect, useState } from 'react';
import { designAllowance, gbp, PRICE, type Billing, type Interval } from '@/lib/plans';
import type { Ws } from './Library';

type State = {
  billing: Billing; role: string | null; stripe: boolean;
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

function PeriodSwitch({ value, onChange }: { value: Interval; onChange: (v: Interval) => void }) {
  return (
    <div className="seg small" role="group" aria-label="Billing period">
      <button type="button" aria-pressed={value === 'month'} onClick={() => onChange('month')}>Monthly</button>
      <button type="button" aria-pressed={value === 'year'} onClick={() => onChange('year')}>Yearly · 2 months free</button>
    </div>
  );
}
const priceLine = (i: Interval) => (i === 'year' ? `${gbp(PRICE.year)} a year per brand` : `${gbp(PRICE.month)} a month per brand`);

// Settings → Plan: this brand's plan, Studio designs this month, upgrade or manage billing.
export function PlanSettings({ ws, toast }: { ws: Ws; toast: (m: string) => void }) {
  const [s, setS] = useState<State | null>(null);
  const [interval, setPeriod] = useState<Interval>('month');
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
                <PeriodSwitch value={interval} onChange={setPeriod} />
                <button className="primary" type="button" disabled={busy} onClick={async () => { setBusy(true); if (!(await go('/api/billing/checkout', { workspace_id: ws.id, interval }, toast))) setBusy(false); }}>
                  Upgrade {ws.name} · {priceLine(interval)}
                </button>
                <p className="tip">Prices exclude VAT. Cancel any time from Manage billing.</p>
              </div>
            )}
        </div>
      )}
    </div>
  );
}

// A second brand you own: Free covers one, so the next one starts on Pro.
export function NewBrandPaywall({ name, onClose, toast }: { name: string; onClose: () => void; toast: (m: string) => void }) {
  const [interval, setPeriod] = useState<Interval>('month');
  const [busy, setBusy] = useState(false);
  return (
    <div className="paywall">
      <h2>Add {name} on Pro</h2>
      <p>Your free plan covers one brand. Each extra brand is {priceLine('month')} (or {gbp(PRICE.year)} a year), with its own library, brand kit, portals and {designAllowance('pro')} Studio designs a month.</p>
      <ul>{PRO_ADDS.slice(1).map((t) => <li key={t}>{t}</li>)}</ul>
      <div className="plan-actions">
        <PeriodSwitch value={interval} onChange={setPeriod} />
        <button className="primary" type="button" disabled={busy} onClick={async () => { setBusy(true); if (!(await go('/api/billing/checkout', { new_brand_name: name, interval }, toast))) setBusy(false); }}>Continue to payment</button>
        <button className="btn quiet" type="button" onClick={onClose}>Not now</button>
      </div>
      <p className="tip">Prices exclude VAT. Or upgrade your current brand from Settings → Plan.</p>
    </div>
  );
}
