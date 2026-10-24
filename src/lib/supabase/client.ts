import { createBrowserClient } from "@supabase/ssr";

// Browser client (signed-in user's session from cookies) — used for direct photo uploads.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
