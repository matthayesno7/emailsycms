-- Mise: the currency a brand pays in (gbp or usd), written by the Stripe webhook.
-- Until a brand pays, the app shows GBP in the UK and USD elsewhere. Safe to run more than once.
alter table public.workspace_billing add column if not exists currency text check (currency in ('gbp', 'usd'));
