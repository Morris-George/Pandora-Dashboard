import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Optional steps switched in Admin → Workflow (all on by default)
export type Workflow = {
  manager_approval: boolean; area_manager: boolean; override_approval: boolean; supervisor_qc: boolean;
  cs_quote: boolean; supervisor_assign: boolean; courier_out: boolean; courier_return: boolean;
};
export const WORKFLOW_DEFAULTS: Workflow = {
  manager_approval: false, area_manager: true, override_approval: true, supervisor_qc: true, cs_quote: true, supervisor_assign: true, courier_out: false, courier_return: false,
};

export async function loadWorkflow(supabase: SupabaseClient): Promise<Workflow> {
  const { data } = await supabase.from("app_settings").select("value").eq("key", "workflow").maybeSingle();
  return { ...WORKFLOW_DEFAULTS, ...(data?.value as Partial<Workflow> | null) };
}
