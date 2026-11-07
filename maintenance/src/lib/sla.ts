import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// SLA targets per stage (days), from sla_rules
export async function loadSla(supabase: SupabaseClient): Promise<Map<string, number>> {
  const { data } = await supabase.from("sla_rules").select("status, max_days");
  return new Map((data ?? []).map((r) => [r.status as string, Number(r.max_days)]));
}

// Days past the stage target (0 = on time / no target)
export function overdueDays(sla: Map<string, number>, status: string, since: string | null, now = Date.now()): number {
  const max = sla.get(status);
  if (!max || !since) return 0;
  const late = (now - new Date(since).getTime()) / 86_400_000 - max;
  return late > 0 ? Math.ceil(late) : 0;
}
