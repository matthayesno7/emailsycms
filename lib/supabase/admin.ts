import { createClient } from '@supabase/supabase-js';

// Service-role client. Bypasses row level security, so every caller must scope
// queries to workspaces the acting user belongs to.
export function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
