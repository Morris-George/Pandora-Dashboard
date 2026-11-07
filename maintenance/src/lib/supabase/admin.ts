import "server-only";
import { createClient } from "@supabase/supabase-js";

// Service-role client: bypasses RLS. Use ONLY inside server actions that first call requireRole("admin").
export function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
