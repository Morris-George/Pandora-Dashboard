"use server";

import { createClient } from "@/lib/supabase/server";

// Sign-in happens on the main login page (pandora-eg.online). The page that called this moves on by itself
// (see SignOutButton): a redirect from here would be followed inside this app, which does not own that page.
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
}
