import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Session } from "@/lib/auth";

export type StoreOption = { id: string; name: string };

// Stores offered in the "Store" filter for roles above the branch manager.
// Branch roles work in their own store, so they get no filter (null).
// Area Managers choose among their assigned stores; every other role (the Courier too) among all stores.
export async function filterStores(me: Session, supabase: SupabaseClient): Promise<StoreOption[] | null> {
  if (me.role === "associate" || me.role === "manager") return null;
  if (me.role === "courier" && !me.isAdmin) return me.branches.map((b) => ({ id: b.id, name: b.name }));
  const { data } = await supabase.from("branches").select("id, name").eq("active", true).eq("is_hq", false).order("name");
  return data ?? [];
}

// The chosen store from ?store=, only when it is one the person may pick
export const pickedStore = (stores: StoreOption[] | null, value?: string) =>
  stores && value && stores.some((s) => s.id === value) ? value : "";
