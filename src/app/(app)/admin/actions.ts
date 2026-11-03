"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, type AppRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runErpSync } from "@/lib/erp-sync";
import { erpConfigured, findItem, getItemPrice } from "@/lib/erpnext";

const ROLES = ["associate", "manager", "courier", "hq", "technician", "supervisor", "cs", "finance", "ops", "admin"] as const;
// Roles tied to stores; area managers (courier) cover several stores
const BRANCH_ROLES: AppRole[] = ["associate", "manager", "courier"];
type Result = { error?: string; password?: string };

// Readable temporary password; the user must change it at first sign-in
const tempPassword = () => randomBytes(9).toString("base64url");

async function audit(actorId: string, action: string, entityId: string, value: unknown) {
  await createAdminClient().from("audit_log").insert({
    user_id: actorId, role: "admin", entity: "profiles", entity_id: entityId, action, new_value: value as object,
  });
}

const NewUser = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(160),
  role: z.enum(ROLES),
  branchIds: z.array(z.string().uuid()).max(20),
});

export async function createUser(input: z.infer<typeof NewUser>): Promise<Result> {
  const me = await requireRole("admin");
  const p = NewUser.safeParse(input);
  if (!p.success) return { error: "invalid" };
  const u = p.data;
  if (BRANCH_ROLES.includes(u.role) && !u.branchIds.length) return { error: "branch_required" };

  const admin = createAdminClient();
  const password = tempPassword();
  const { data, error } = await admin.auth.admin.createUser({ email: u.email, password, email_confirm: true });
  if (error) return { error: error.message.toLowerCase().includes("already") ? "exists" : "failed" };

  const id = data.user.id;
  const prof = await admin.from("profiles").insert({
    id, full_name: u.fullName, email: u.email, role: u.role, source: "manual", must_change_password: true,
  });
  if (prof.error) { await admin.auth.admin.deleteUser(id); return { error: "failed" }; }
  if (BRANCH_ROLES.includes(u.role)) {
    await admin.from("user_branches").insert(u.branchIds.map((b) => ({ user_id: id, branch_id: b })));
  }
  await audit(me.userId, "user_created", id, { email: u.email, role: u.role, branches: u.branchIds });
  revalidatePath("/admin");
  return { password };
}

export async function setActive(userId: string, active: boolean): Promise<Result> {
  const me = await requireRole("admin");
  z.string().uuid().parse(userId);
  if (userId === me.userId) return { error: "self" };
  const admin = createAdminClient();
  // A manual change is the admin's decision: the ERPNext sync will not undo it
  await admin.from("profiles").update({ active, deactivated_by_sync: false }).eq("id", userId);
  // A ban also ends existing sessions; ~100 years when deactivated
  await admin.auth.admin.updateUserById(userId, { ban_duration: active ? "none" : "876000h" });
  await audit(me.userId, active ? "user_reactivated" : "user_deactivated", userId, { active });
  revalidatePath("/admin");
  return {};
}

export async function resetPassword(userId: string): Promise<Result> {
  const me = await requireRole("admin");
  z.string().uuid().parse(userId);
  const admin = createAdminClient();
  const password = tempPassword();
  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) return { error: "failed" };
  await admin.from("profiles").update({ must_change_password: true }).eq("id", userId);
  await audit(me.userId, "password_reset", userId, {});
  revalidatePath("/admin");
  return { password };
}

// Change a user's sign-in email. ERPNext accounts become manual: the sync matches by email,
// so it would otherwise recreate the old address.
export async function changeEmail(userId: string, email: string): Promise<Result> {
  const me = await requireRole("admin");
  z.string().uuid().parse(userId);
  const e = z.string().trim().toLowerCase().email().max(160).safeParse(email);
  if (!e.success) return { error: "invalid" };
  const admin = createAdminClient();
  const { data: cur } = await admin.from("profiles").select("email, source").eq("id", userId).single();
  if (!cur) return { error: "failed" };
  if (cur.email.toLowerCase() === e.data) return {};
  const { data: taken } = await admin.from("profiles").select("id").ilike("email", e.data).maybeSingle();
  if (taken) return { error: "exists" };
  const { error } = await admin.auth.admin.updateUserById(userId, { email: e.data, email_confirm: true });
  if (error) return { error: error.message.toLowerCase().includes("already") ? "exists" : "failed" };
  await admin.from("profiles").update({ email: e.data, ...(cur.source === "erpnext" ? { source: "manual" } : {}) }).eq("id", userId);
  if (cur.source === "erpnext") await admin.from("erp_sync_exclusions").upsert({ email: cur.email.toLowerCase(), reason: `Email changed to ${e.data}` });
  await audit(me.userId, "email_changed", userId, { from: cur.email, to: e.data });
  revalidatePath("/admin");
  return {};
}

const bi = z.object({ ar: z.string().max(600), en: z.string().max(600) });
const ReceiptInput = z.object({
  logo: z.enum(["pandora", "custom", "none"]),
  customLogo: z.string().max(420_000).refine((v) => !v || /^data:image\/(png|jpeg);base64,/.test(v)),
  storeLine: z.string().max(120), phone: z.string().max(40), website: z.string().max(80),
  showMobile: z.boolean(), showItemCode: z.boolean(), showQr: z.boolean(), showAgreed: z.boolean(),
  termsIntake: bi, termsDelivery: bi, footer: bi,
});

// Admin → Receipt layout
export async function saveReceiptSettings(input: unknown): Promise<Result> {
  const me = await requireRole("admin");
  const v = ReceiptInput.safeParse(input);
  if (!v.success) return { error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.from("app_settings").update({ value: v.data, updated_by: me.userId, updated_at: new Date().toISOString() }).eq("key", "receipt");
  if (error) return { error: "failed" };
  revalidatePath("/admin");
  return {};
}

// Mail server settings (Admin → Email). An empty password keeps the saved one; it is never read back.
const Mail = z.object({
  host: z.string().trim().max(200), port: z.coerce.number().int().min(1).max(65535),
  username: z.string().trim().max(200), password: z.string().max(200),
  fromName: z.string().trim().max(120), fromEmail: z.string().trim().toLowerCase().email().max(200).or(z.literal("")),
  paused: z.boolean(),
});
export async function saveMailSettings(input: z.input<typeof Mail>): Promise<Result> {
  const me = await requireRole("admin");
  const p = Mail.safeParse(input);
  if (!p.success) return { error: "invalid" };
  const d = p.data;
  const { error } = await createAdminClient().from("mail_settings").upsert({
    id: true, host: d.host || null, port: d.port, username: d.username || null, from_name: d.fromName || null, from_email: d.fromEmail || null,
    paused: d.paused, updated_by: me.userId, updated_at: new Date().toISOString(), ...(d.password ? { password: d.password } : {}),
  });
  if (error) return { error: "failed" };
  await audit(me.userId, "mail_settings_saved", "mail_settings", { host: d.host, port: d.port, username: d.username, from: d.fromEmail, paused: d.paused, passwordChanged: !!d.password });
  revalidatePath("/admin");
  return {};
}

// Sends one test email to any address (default: the signed-in Super Admin)
export async function testEmail(to?: string): Promise<{ error?: string; to?: string }> {
  const me = await requireRole("admin");
  const addr = z.string().trim().email().safeParse(to || me.email);
  if (!addr.success) return { error: "invalid email" };
  const { sendTestEmail } = await import("@/lib/email");
  const err = await sendTestEmail(addr.data);
  return err ? { error: err } : { to: addr.data };
}

// Menu names from Admin → Menu: { "/tickets": { ar, en } }; empty names fall back to the built-in ones
export async function saveMenuLabels(input: Record<string, { ar?: string; en?: string }>): Promise<Result> {
  const me = await requireRole("admin");
  const { NAV } = await import("@/lib/nav");
  const clean = (v?: string) => (v ?? "").trim().slice(0, 40);
  const value = Object.fromEntries(NAV.map((n) => [n.href, { ar: clean(input[n.href]?.ar), en: clean(input[n.href]?.en) }])
    .filter(([, v]) => (v as { ar: string; en: string }).ar || (v as { ar: string; en: string }).en));
  const supabase = await createClient();
  // Update, not upsert: admins may not insert into app_settings (the row comes from a migration)
  const { data: saved, error } = await supabase.from("app_settings").update({ value, updated_by: me.userId, updated_at: new Date().toISOString() }).eq("key", "menu_labels").select("key");
  if (!error && !saved?.length) return { error: "failed" };
  if (error) return { error: "failed" };
  await audit(me.userId, "menu_labels_saved", "menu_labels", value);
  revalidatePath("/", "layout");
  return {};
}

// Optional dispatch steps (manager approval, area manager handover) on / off
const STEPS = ["manager_approval", "area_manager", "override_approval", "supervisor_qc", "cs_quote", "supervisor_assign"] as const;
export async function setWorkflowStep(step: (typeof STEPS)[number], on: boolean): Promise<Result> {
  const me = await requireRole("admin");
  if (!STEPS.includes(step)) return { error: "invalid" };
  const supabase = await createClient();
  const { data: cur } = await supabase.from("app_settings").select("value").eq("key", "workflow").maybeSingle();
  const value = { ...Object.fromEntries(STEPS.map((k) => [k, true])), ...(cur?.value as object | null), [step]: on };
  // Update, not upsert: admins may not insert into app_settings (the row comes from a migration)
  const { data: saved, error } = await supabase.from("app_settings").update({ value, updated_by: me.userId, updated_at: new Date().toISOString() }).eq("key", "workflow").select("key");
  if (!error && !saved?.length) return { error: "failed" };
  if (error) return { error: "failed" };
  await audit(me.userId, `workflow_${step}_${on ? "on" : "off"}`, "workflow", value);
  revalidatePath("/admin");
  revalidatePath("/dispatch");
  revalidatePath("/diagnosis");
  revalidatePath("/quotes");
  revalidatePath("/", "layout");
  return {};
}

// Two-step login for Super Admins on / off (on by default)
export async function setTwoStep(on: boolean): Promise<Result> {
  const me = await requireRole("admin");
  const supabase = await createClient();
  const { error } = await supabase.from("app_settings").update({ value: on, updated_by: me.userId, updated_at: new Date().toISOString() }).eq("key", "admin_two_step");
  if (error) return { error: "failed" };
  await audit(me.userId, on ? "two_step_on" : "two_step_off", "admin_two_step", {});
  revalidatePath("/admin");
  return {};
}

// Lost phone: another Super Admin clears the person's authenticator; they set it up again at next sign-in
export async function resetTwoStep(userId: string): Promise<Result> {
  const me = await requireRole("admin");
  z.string().uuid().parse(userId);
  if (userId === me.userId) return { error: "self" };
  const admin = createAdminClient();
  const { data } = await admin.auth.admin.mfa.listFactors({ userId });
  for (const f of data?.factors ?? []) await admin.auth.admin.mfa.deleteFactor({ userId, id: f.id });
  await admin.auth.admin.signOut(userId).catch(() => undefined);
  await audit(me.userId, "two_step_reset", userId, {});
  revalidatePath("/admin");
  return {};
}

export async function setBranches(userId: string, branchIds: string[]): Promise<Result> {
  const me = await requireRole("admin");
  z.string().uuid().parse(userId);
  const ids = z.array(z.string().uuid()).max(20).parse(branchIds);
  const admin = createAdminClient();
  await admin.from("user_branches").delete().eq("user_id", userId);
  if (ids.length) await admin.from("user_branches").insert(ids.map((b) => ({ user_id: userId, branch_id: b })));
  await audit(me.userId, "branches_changed", userId, { branches: ids });
  revalidatePath("/admin");
  return {};
}

// SoD-4: a role change needs a second admin to approve
export async function requestRoleChange(userId: string, newRole: string): Promise<Result> {
  const me = await requireRole("admin");
  z.string().uuid().parse(userId);
  const role = z.enum(ROLES).parse(newRole);
  if (userId === me.userId) return { error: "self" };
  const admin = createAdminClient();
  const { data: cur } = await admin.from("profiles").select("role").eq("id", userId).single();
  if (!cur) return { error: "failed" };
  // Owner's decision: role changes apply at once; making or removing a Super Admin still needs a second admin
  if (role !== "admin" && cur.role !== "admin") {
    await admin.from("profiles").update({ role }).eq("id", userId);
    if (role !== "associate" && role !== "manager") await admin.from("user_branches").delete().eq("user_id", userId); // central roles see every store
    await admin.from("role_change_requests").update({ status: "rejected" }).eq("user_id", userId).eq("status", "pending");
    await audit(me.userId, "role_changed", userId, { from: cur.role, to: role });
    revalidatePath("/admin");
    return {};
  }
  await admin.from("role_change_requests").update({ status: "rejected" }).eq("user_id", userId).eq("status", "pending");
  await admin.from("role_change_requests").insert({ user_id: userId, new_role: role, requested_by: me.userId });
  await audit(me.userId, "role_change_requested", userId, { new_role: role });
  revalidatePath("/admin");
  return {};
}

export async function decideRoleChange(requestId: string, approve: boolean): Promise<Result> {
  const me = await requireRole("admin");
  const admin = createAdminClient();
  const { data: req } = await admin.from("role_change_requests").select("*").eq("id", requestId).eq("status", "pending").maybeSingle();
  if (!req) return { error: "failed" };
  if (req.requested_by === me.userId) return { error: "same_admin" };
  await admin.from("role_change_requests").update({ status: approve ? "approved" : "rejected", approved_by: me.userId }).eq("id", requestId);
  if (approve) await admin.from("profiles").update({ role: req.new_role }).eq("id", req.user_id);
  await audit(me.userId, approve ? "role_change_approved" : "role_change_rejected", req.user_id, { new_role: req.new_role });
  revalidatePath("/admin");
  return {};
}

// Fault categories: regular client — RLS lets only admin write, and triggers audit + protect "Other"
const Cat = z.object({
  name: z.string().trim().min(2).max(60),
  nameAr: z.string().trim().max(60).optional(),
  requiresComment: z.boolean(),
});

export async function addCategory(input: z.infer<typeof Cat>): Promise<Result> {
  await requireRole("admin");
  const p = Cat.safeParse(input);
  if (!p.success) return { error: "invalid" };
  const supabase = await createClient();
  const { data: last } = await supabase.from("fault_categories").select("sort_order").neq("name", "Other").order("sort_order", { ascending: false }).limit(1);
  const { error } = await supabase.from("fault_categories").insert({
    name: p.data.name, name_ar: p.data.nameAr || null, requires_comment: p.data.requiresComment,
    sort_order: (last?.[0]?.sort_order ?? 0) + 10,
  });
  if (error) return { error: error.code === "23505" ? "exists" : "failed" };
  revalidatePath("/admin");
  revalidatePath("/intake");
  return {};
}

export async function updateCategory(name: string, patch: { active?: boolean; requiresComment?: boolean; nameAr?: string }): Promise<Result> {
  await requireRole("admin");
  const supabase = await createClient();
  const row: Record<string, unknown> = {};
  if (patch.active !== undefined) row.active = patch.active;
  if (patch.requiresComment !== undefined) row.requires_comment = patch.requiresComment;
  if (patch.nameAr !== undefined) row.name_ar = patch.nameAr.trim() || null;
  const { error } = await supabase.from("fault_categories").update(row).eq("name", name);
  if (error) return { error: "failed" };
  revalidatePath("/admin");
  revalidatePath("/intake");
  return {};
}

const ReportGrant = z.object({
  reportKey: z.string().min(1).max(40),
  role: z.enum(ROLES).exclude(["admin"]),
  level: z.enum(["none", "view", "export"]),
});

// Report access matrix (BRD 4.6); the audit trigger on report_access logs every change
export async function setReportAccess(input: z.infer<typeof ReportGrant>): Promise<Result> {
  await requireRole("admin");
  const p = ReportGrant.safeParse(input);
  if (!p.success) return { error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.from("report_access").upsert(
    { report_key: p.data.reportKey, role: p.data.role, level: p.data.level, updated_at: new Date().toISOString() },
    { onConflict: "report_key,role" },
  );
  if (error) return { error: "failed" };
  revalidatePath("/admin");
  return {};
}

// ---- ERPNext sync -------------------------------------------------------------------------

export async function syncNow(): Promise<Result & { summary?: Awaited<ReturnType<typeof runErpSync>> }> {
  await requireRole("admin");
  const summary = await runErpSync("manual");
  revalidatePath("/admin");
  return summary.errors.length ? { error: "sync", summary } : { summary };
}

// Keep someone out of the sync (e.g. senior management); their account, if any, is deactivated
export async function excludeFromSync(userId: string, reason: string): Promise<Result> {
  const me = await requireRole("admin");
  z.string().uuid().parse(userId);
  if (userId === me.userId) return { error: "self" };
  const admin = createAdminClient();
  const { data: p } = await admin.from("profiles").select("email").eq("id", userId).single();
  if (!p) return { error: "failed" };
  await admin.from("erp_sync_exclusions").upsert({ email: p.email.toLowerCase(), reason: reason.trim().slice(0, 200) || null, created_by: me.userId });
  await admin.from("profiles").update({ active: false, deactivated_by_sync: false }).eq("id", userId);
  await admin.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
  await audit(me.userId, "excluded_from_sync", userId, { reason });
  revalidatePath("/admin");
  return {};
}

export async function includeInSync(email: string): Promise<Result> {
  const me = await requireRole("admin");
  const e = z.string().email().parse(email.toLowerCase());
  const admin = createAdminClient();
  await admin.from("erp_sync_exclusions").delete().eq("email", e);
  // Let the next sync decide whether the account should be active again
  await admin.from("profiles").update({ deactivated_by_sync: true }).eq("email", e).eq("source", "erpnext").eq("active", false);
  await audit(me.userId, "included_in_sync", e, { email: e });
  revalidatePath("/admin");
  return {};
}

// Delete an account that has no history; one that has worked on tickets is deactivated instead
export async function deleteUser(userId: string): Promise<Result & { deactivated?: boolean }> {
  const me = await requireRole("admin");
  z.string().uuid().parse(userId);
  if (userId === me.userId) return { error: "self" };
  const admin = createAdminClient();
  const { data: p } = await admin.from("profiles").select("email, source").eq("id", userId).single();
  if (!p) return { error: "failed" };
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    // Referenced by tickets, batches, payments… keep the record, block the account
    await admin.from("profiles").update({ active: false, deactivated_by_sync: false }).eq("id", userId);
    await admin.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
    await audit(me.userId, "user_deactivated", userId, { reason: "has_history" });
    revalidatePath("/admin");
    return { deactivated: true };
  }
  // An ERPNext account would come straight back on the next sync, so keep it out
  if (p.source === "erpnext") await admin.from("erp_sync_exclusions").upsert({ email: p.email.toLowerCase(), reason: "deleted by admin", created_by: me.userId });
  await audit(me.userId, "user_deleted", userId, { email: p.email });
  revalidatePath("/admin");
  return {};
}

// ---- Sales persons (from ERPNext) ---------------------------------------------------------

const spName = z.string().trim().min(1).max(140);

// Allocate a store when ERPNext's group doesn't give one (null = back to the ERPNext group)
export async function setSalesPersonStore(erpName: string, branchId: string | null): Promise<Result> {
  const me = await requireRole("admin");
  const n = spName.parse(erpName);
  const admin = createAdminClient();
  await admin.from("sales_persons").update({ branch_override: branchId ? z.string().uuid().parse(branchId) : null }).eq("erp_name", n);
  // A linked associate/manager account follows the allocation
  const { data: sp } = await admin.from("sales_persons").select("profile_id, branch_id, branch_override").eq("erp_name", n).single();
  const target = sp?.branch_override ?? sp?.branch_id;
  if (sp?.profile_id && target) {
    const { data: p } = await admin.from("profiles").select("role").eq("id", sp.profile_id).single();
    if (p && (p.role === "associate" || p.role === "manager")) {
      await admin.from("user_branches").delete().eq("user_id", sp.profile_id);
      await admin.from("user_branches").insert({ user_id: sp.profile_id, branch_id: target });
    }
  }
  await audit(me.userId, "sales_person_store", n, { branchId });
  revalidatePath("/admin");
  return {};
}

export async function linkSalesPerson(erpName: string, profileId: string | null): Promise<Result> {
  const me = await requireRole("admin");
  const n = spName.parse(erpName);
  await createAdminClient().from("sales_persons").update({ profile_id: profileId ? z.string().uuid().parse(profileId) : null }).eq("erp_name", n);
  await audit(me.userId, "sales_person_linked", n, { profileId });
  revalidatePath("/admin");
  return {};
}

// "Add": create a platform account for a sales person who has none (temporary password shown once)
export async function createAccountForSalesPerson(erpName: string, email: string, role: "associate" | "manager"): Promise<Result> {
  await requireRole("admin");
  const n = spName.parse(erpName);
  const admin = createAdminClient();
  const { data: sp } = await admin.from("sales_persons").select("branch_id, branch_override").eq("erp_name", n).single();
  const branch = sp?.branch_override ?? sp?.branch_id;
  if (!branch) return { error: "branch_required" };
  const r = await createUser({ fullName: n, email, role, branchIds: [branch] });
  if (r.error) return r;
  const { data: p } = await admin.from("profiles").select("id").eq("email", email.trim().toLowerCase()).single();
  if (p) await admin.from("sales_persons").update({ profile_id: p.id }).eq("erp_name", n);
  revalidatePath("/admin");
  return r;
}

// "Delete": hide a sales person from the lists (ERPNext stays the source, so they are not erased)
// Change a user's display name; the sync then keeps it (name_locked)
export async function renameUser(userId: string, name: string): Promise<Result> {
  const me = await requireRole("admin");
  z.string().uuid().parse(userId);
  const n = z.string().trim().min(2).max(120).safeParse(name);
  if (!n.success) return { error: "invalid" };
  await createAdminClient().from("profiles").update({ full_name: n.data, name_locked: true }).eq("id", userId);
  await audit(me.userId, "name_changed", userId, { to: n.data });
  revalidatePath("/admin");
  return {};
}

// Merge: link the ERPNext sales person to an existing account and give the account the ERPNext name
export async function mergeSalesPerson(erpName: string, profileId: string): Promise<Result> {
  const me = await requireRole("admin");
  const n = spName.parse(erpName);
  const id = z.string().uuid().parse(profileId);
  const admin = createAdminClient();
  await admin.from("sales_persons").update({ profile_id: null }).eq("profile_id", id).neq("erp_name", n);
  await admin.from("sales_persons").update({ profile_id: id }).eq("erp_name", n);
  await admin.from("profiles").update({ full_name: n, name_locked: true }).eq("id", id);
  await audit(me.userId, "sales_person_merged", n, { profileId: id });
  revalidatePath("/admin");
  return {};
}

// Stop sync for one sales person: the sync keeps their store and status as they are
export async function setSalesPersonSyncPaused(erpName: string, paused: boolean): Promise<Result> {
  const me = await requireRole("admin");
  const n = spName.parse(erpName);
  await createAdminClient().from("sales_persons").update({ sync_paused: paused }).eq("erp_name", n);
  await audit(me.userId, paused ? "sales_person_sync_stopped" : "sales_person_sync_resumed", n, {});
  revalidatePath("/admin");
  return {};
}

export async function setSalesPersonIgnored(erpName: string, ignored: boolean): Promise<Result> {
  const me = await requireRole("admin");
  const n = spName.parse(erpName);
  await createAdminClient().from("sales_persons").update({ ignored }).eq("erp_name", n);
  await audit(me.userId, ignored ? "sales_person_removed" : "sales_person_restored", n, {});
  revalidatePath("/admin");
  return {};
}

// Store WhatsApp number; Egyptian 01xxxxxxxxx becomes +201xxxxxxxxx. Empty clears it.
export async function setBranchWhatsapp(branchId: string, number: string): Promise<{ error?: string; value?: string | null }> {
  const me = await requireRole("admin");
  z.string().uuid().parse(branchId);
  let digits = number.replace(/[^0-9]/g, "");
  if (/^01[0-9]{9}$/.test(digits)) digits = "2" + digits;
  const value = digits ? `+${digits}` : null;
  if (value && !/^\+[0-9]{8,15}$/.test(value)) return { error: "invalid" };
  const { error } = await createAdminClient().from("branches").update({ whatsapp: value }).eq("id", branchId);
  if (error) return { error: "failed" };
  await audit(me.userId, "store_whatsapp", branchId, { whatsapp: value });
  revalidatePath("/admin");
  return { value };
}

// Fault category cost: link an ERPNext service item; its price is used unless the admin types one
export async function setCategoryCost(name: string, itemCode: string, cost: string): Promise<Result & { price?: number | null }> {
  await requireRole("admin");
  const code = itemCode.trim().slice(0, 60);
  const typed = cost.trim() ? Number(cost.trim()) : null;
  if (typed !== null && (!Number.isFinite(typed) || typed < 0 || typed > 1_000_000)) return { error: "invalid" };
  const row: Record<string, unknown> = { erp_item_code: null, erp_item_name: null, cost: typed, cost_source: typed === null ? null : "manual" };
  if (code) {
    if (!erpConfigured()) return { error: "erp" };
    const item = await findItem(code).catch(() => null);
    if (!item) return { error: "erpNotFound" };
    row.erp_item_code = item.itemCode;
    row.erp_item_name = item.itemName;
    if (typed === null) {
      const price = await getItemPrice(item.itemCode);
      row.cost = price;
      row.cost_source = price === null ? null : "erp";
    }
  }
  const supabase = await createClient();
  const { error } = await supabase.from("fault_categories").update(row).eq("name", name);
  if (error) return { error: "failed" };
  revalidatePath("/admin");
  revalidatePath("/intake");
  revalidatePath("/diagnosis");
  return { price: row.cost as number | null };
}

// Refresh every ERPNext-priced category cost (typed costs stay)
export async function syncCategoryCosts(): Promise<Result & { synced?: number }> {
  await requireRole("admin");
  if (!erpConfigured()) return { error: "erp" };
  const supabase = await createClient();
  const { data } = await supabase.from("fault_categories").select("name, erp_item_code, cost_source").not("erp_item_code", "is", null);
  let synced = 0;
  for (const c of data ?? []) {
    if (c.cost_source === "manual") continue;
    const price = await getItemPrice(c.erp_item_code!);
    if (price === null) continue;
    await supabase.from("fault_categories").update({ cost: price, cost_source: "erp" }).eq("name", c.name);
    synced++;
  }
  revalidatePath("/admin");
  return { synced };
}

// SLA targets (days per stage)
export async function saveSla(rows: { status: string; days: number }[]): Promise<Result> {
  await requireRole("admin");
  const p = z.array(z.object({ status: z.string().min(1).max(40), days: z.number().positive().max(365) })).max(30).safeParse(rows);
  if (!p.success) return { error: "invalid" };
  const supabase = await createClient();
  for (const r of p.data) {
    const { error } = await supabase.from("sla_rules").update({ max_days: r.days, updated_at: new Date().toISOString() }).eq("status", r.status);
    if (error) return { error: "failed" };
  }
  revalidatePath("/admin");
  revalidatePath("/");
  revalidatePath("/tickets");
  return {};
}
