"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

import { EXCEPTIONS, type ExceptionTarget } from "./exceptions";

export async function exceptionMove(ticketId: string, to: ExceptionTarget, reason: string): Promise<{ error?: string }> {
  await requireSession();
  const p = z.object({ id: z.string().uuid(), to: z.enum(EXCEPTIONS), reason: z.string().trim().max(1000) })
    .safeParse({ id: ticketId, to, reason });
  if (!p.success) return { error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("transition_ticket", { p_ticket: p.data.id, p_to: p.data.to, p_reason: p.data.reason || null });
  if (error) return { error: error.message.includes("reason") ? "reason" : error.message.includes("may not") ? "denied" : "failed" };
  revalidatePath(`/tickets/${p.data.id}`);
  return {};
}

// Super Admin only: permanently removes a ticket, its history and photos. The audit log keeps who, why and a copy.
export async function deleteTicket(ticketId: string, reason: string, typedNo: string): Promise<{ error?: string }> {
  const me = await requireRole("admin");
  const p = z.object({ id: z.string().uuid(), reason: z.string().trim().min(1).max(1000), typedNo: z.string().trim() })
    .safeParse({ id: ticketId, reason, typedNo });
  if (!p.success) return { error: "reason" };
  const db = createAdminClient();
  const { data: tk } = await db.from("tickets").select("*").eq("id", p.data.id).maybeSingle();
  if (!tk) return { error: "failed" };
  if (tk.ticket_no !== p.data.typedNo) return { error: "mismatch" };

  const { error: ae } = await db.from("audit_log").insert({
    user_id: me.userId, role: "admin", entity: "tickets", entity_id: tk.id, action: "ticket_deleted", new_value: { reason: p.data.reason, ticket: tk },
  });
  if (ae) return { error: "failed" };

  const { data: media } = await db.from("ticket_media").select("storage_path").eq("ticket_id", tk.id);
  if (media?.length) await db.storage.from("ticket-media").remove(media.map((m) => m.storage_path));
  const { data: items } = await db.from("batch_items").select("batch_id").eq("ticket_id", tk.id);
  for (const table of ["batch_items", "location_movements", "status_history", "payments", "parts_consumption", "integration_outbox", "email_outbox", "notification_log", "quotations", "diagnoses", "ticket_media"]) {
    const { error } = await db.from(table).delete().eq("ticket_id", tk.id);
    if (error) return { error: "failed" };
  }
  // A shipment that held only this ticket has nothing left in it
  for (const batch of new Set((items ?? []).map((i) => i.batch_id))) {
    const { count } = await db.from("batch_items").select("batch_id", { count: "exact", head: true }).eq("batch_id", batch);
    if (count) continue;
    await db.from("location_movements").delete().eq("batch_id", batch);
    await db.from("dispatch_batches").delete().eq("id", batch);
  }
  const { error } = await db.from("tickets").delete().eq("id", tk.id);
  if (error) return { error: "failed" };
  revalidatePath("/tickets");
  return {};
}
