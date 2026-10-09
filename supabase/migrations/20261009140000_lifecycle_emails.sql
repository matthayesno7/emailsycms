-- Mise: welcome emails. Records when each was sent, so a retry or a repeat event never sends it twice.
-- Safe to run more than once.

-- Email 1 (welcome) is per person: signup_handled_at is claimed once, the first time a new account
-- signs in; welcome_sent_at when the welcome went out (people who joined through an invite don't get one).
alter table public.profiles
  add column if not exists signup_handled_at timestamptz,
  add column if not exists welcome_sent_at timestamptz;

-- Email 2 (welcome to Pro) is per brand.
alter table public.workspace_billing
  add column if not exists pro_welcome_sent_at timestamptz;

-- Everyone who already has an account, and every brand already on Pro, counts as done: switching this
-- on doesn't email existing customers. (Only rows from before this migration: new ones start empty.)
update public.profiles set signup_handled_at = coalesce(signup_handled_at, now()) where signup_handled_at is null and created_at < now();
update public.workspace_billing set pro_welcome_sent_at = coalesce(pro_welcome_sent_at, now()) where pro_welcome_sent_at is null and plan <> 'free';
