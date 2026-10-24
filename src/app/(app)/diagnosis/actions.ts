"use server";

import { after } from "next/server";
import { flushEmails } from "@/lib/email";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type Result = { error?: string; outcome?: string };

function errorKey(message: string): string {
  if (message.includes("SoD")) return "sod";
  if (message.includes("reason")) return "reason";
  if (message.includes("quote line") || message.includes("quote lines")) return "quote";
  if (message.includes("fault found")) return "fault";
  if (message.includes("assigned technician")) return "notAssigned";
  if (message.includes("not under diagnosis") || message.includes("no override") || message.includes("not allowed")) return "stale";
  return "failed";
}

const done = (outcome?: string): Result => {
  revalidatePath("/diagnosis");
  revalidatePath("/tickets");
  return { outcome };
};

const id = z.string().uuid();
const QuoteLine = z.object({ desc: z.string().trim().min(1).max(120), qty: z.number().positive().max(999), price: z.number().min(0).max(1_000_000) });
const Part = z.object({ code: z.string().trim().min(1).max(60), qty: z.number().positive().max(999) });

export async function startDiagnosis(ticketId: string, technicianId: string): Promise<Result> {
  await requireRole("supervisor", "hq");
  const supabase = await createClient();
  const { error } = await supabase.rpc("start_diagnosis", { p_ticket: id.parse(ticketId), p_technician: id.parse(technicianId) });
  if (error) return { error: errorKey(error.message) };
  return done();
}

const Diagnosis = z.object({
  ticketId: id,
  fault: z.string().trim().min(1).max(1000),
  rootCause: z.string().trim().max(1000),
  warranty: z.enum(["under_warranty", "out_of_warranty"]),
  exclusion: z.string().trim().max(60),
  overrideReason: z.string().trim().max(1000),
  quote: z.array(QuoteLine).max(30),
});

export async function submitDiagnosis(input: z.infer<typeof Diagnosis>): Promise<Result> {
  await requireRole("technician", "supervisor");
  const p = Diagnosis.safeParse(input);
  if (!p.success) return { error: !input.fault?.trim() ? "fault" : "invalid" };
  const d = p.data;
  const supabase = await createClient();
  after(() => flushEmails()); // send any customer email this queues
  const { data, error } = await supabase.rpc("submit_diagnosis", {
    p_ticket: d.ticketId, p_fault: d.fault, p_root_cause: d.rootCause, p_warranty: d.warranty,
    p_exclusion: d.exclusion, p_override_reason: d.overrideReason, p_quote: d.warranty === "out_of_warranty" ? d.quote : [],
  });
  if (error) return { error: errorKey(error.message) };
  return done(data as string);
}

export async function decideOverride(ticketId: string, approve: boolean): Promise<Result> {
  await requireRole("supervisor");
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_override", { p_ticket: id.parse(ticketId), p_approve: approve });
  if (error) return { error: errorKey(error.message) };
  return done();
}

export async function completeRepair(ticketId: string, parts: z.infer<typeof Part>[]): Promise<Result> {
  await requireRole("technician");
  const p = z.array(Part).max(30).safeParse(parts);
  if (!p.success) return { error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("complete_repair", { p_ticket: id.parse(ticketId), p_parts: p.data });
  if (error) return { error: errorKey(error.message) };
  return done();
}

// Simple status steps that only need the state machine (reason where it requires one)
const STEPS = {
  awaiting_parts: ["technician", "supervisor"],
  resume: ["supervisor"],
  qc_pass: ["supervisor"],
  qc_fail: ["supervisor"],
  unrepairable: ["supervisor"],
} as const;
const TARGET: Record<keyof typeof STEPS, string> = {
  awaiting_parts: "awaiting_parts", resume: "in_repair", qc_pass: "ready_to_return", qc_fail: "in_repair", unrepairable: "unrepairable",
};

export async function moveTicket(ticketId: string, step: keyof typeof STEPS, reason: string): Promise<Result> {
  if (!(step in STEPS)) return { error: "invalid" };
  await requireRole(...STEPS[step]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("transition_ticket", {
    p_ticket: id.parse(ticketId), p_to: TARGET[step], p_reason: reason.trim().slice(0, 1000) || null,
  });
  if (error) return { error: errorKey(error.message) };
  return done();
}
