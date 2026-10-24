import "server-only";
import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { erpConfigured, getErpUsers, listPandoraStores, listSalesPersons, PANDORA_PREFIX } from "@/lib/erpnext";

// ERPNext → platform sync (BRD 8A), Pandora stores only.
// - Branches: one per "Pandora …" POS Profile (linked by erp_pos_profile).
// - Store staff: every enabled ERPNext user on a Pandora POS Profile gets an account (source 'erpnext',
//   role Branch Associate by default) with that profile's branch. Moving profile in ERPNext moves the branch here.
// - Disabled in ERPNext, or on no Pandora POS Profile any more → deactivated here.
// - Roles are never changed by the sync, and admin exclusions / manual deactivations are respected.

export type SyncSummary = {
  branchesCreated: number; branchesUpdated: number;
  usersCreated: number; usersUpdated: number; usersDeactivated: number; usersReactivated: number;
  skippedExcluded: number;
  salesPersonsNew: number; salesPersonsUpdated: number; salesPersonsDisabled: number; salesPersonsUnallocated: number;
  errors: string[];
};

const displayName = (posProfile: string) => posProfile.replace(new RegExp(`^${PANDORA_PREFIX}\\s+`, "i"), "").trim();
const codeFor = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 20);

export async function runErpSync(trigger: "cron" | "manual" | "login", onlyEmail?: string): Promise<SyncSummary> {
  const db = createAdminClient();
  const s: SyncSummary = { branchesCreated: 0, branchesUpdated: 0, usersCreated: 0, usersUpdated: 0, usersDeactivated: 0, usersReactivated: 0, skippedExcluded: 0, salesPersonsNew: 0, salesPersonsUpdated: 0, salesPersonsDisabled: 0, salesPersonsUnallocated: 0, errors: [] };
  if (!erpConfigured()) { s.errors.push("ERPNext is not configured"); return s; }
  const { data: run } = await db.from("erp_sync_runs").insert({ trigger }).select("id").single();
  const audit = (action: string, entityId: string, value: object) =>
    db.from("audit_log").insert({ user_id: null, role: null, entity: "profiles", entity_id: entityId, action, new_value: { ...value, via: "erp_sync" } });

  try {
    const stores = await listPandoraStores();

    // ---- Branches (skipped for a single-user login refresh) ----
    const { data: branches } = await db.from("branches").select("id, code, name, erp_pos_profile, erp_warehouse, active, is_hq");
    const byProfile = new Map((branches ?? []).filter((b) => b.erp_pos_profile).map((b) => [b.erp_pos_profile as string, b]));
    for (const st of stores) {
      let b = byProfile.get(st.posProfile);
      const name = displayName(st.posProfile);
      if (!b && !onlyEmail) {
        // Link a placeholder branch with the same name instead of duplicating it
        const same = (branches ?? []).find((x) => !x.erp_pos_profile && !x.is_hq && x.name.toLowerCase() === name.toLowerCase());
        if (same) {
          await db.from("branches").update({ erp_pos_profile: st.posProfile, erp_warehouse: st.warehouse, active: !st.disabled }).eq("id", same.id);
          b = { ...same, erp_pos_profile: st.posProfile }; s.branchesUpdated++;
        } else {
          const { data: created } = await db.from("branches")
            .insert({ code: codeFor(name), name, erp_pos_profile: st.posProfile, erp_warehouse: st.warehouse, active: !st.disabled })
            .select("id, code, name, erp_pos_profile, erp_warehouse, active, is_hq").single();
          if (created) { b = created; s.branchesCreated++; }
        }
      } else if (b && !onlyEmail && (b.erp_warehouse !== st.warehouse || b.active === st.disabled)) {
        await db.from("branches").update({ erp_warehouse: st.warehouse, active: !st.disabled }).eq("id", b.id);
        s.branchesUpdated++;
      }
      if (b) byProfile.set(st.posProfile, b);
    }

    // ---- Who works where, according to ERPNext ----
    const storesOf = new Map<string, string[]>(); // email → branch ids
    for (const st of stores.filter((x) => !x.disabled)) {
      const b = byProfile.get(st.posProfile);
      if (!b) continue;
      for (const email of st.users) storesOf.set(email, [...(storesOf.get(email) ?? []), b.id]);
    }

    const { data: excl } = await db.from("erp_sync_exclusions").select("email");
    const excluded = new Set((excl ?? []).map((e) => e.email.toLowerCase()));
    const { data: profiles } = await db.from("profiles").select("id, email, role, active, source, deactivated_by_sync, name_locked");
    const existing = new Map((profiles ?? []).map((p) => [p.email.toLowerCase(), p]));

    const wanted = onlyEmail ? [onlyEmail.toLowerCase()] : [...new Set([...storesOf.keys(), ...(profiles ?? []).filter((p) => p.source === "erpnext").map((p) => p.email.toLowerCase())])];
    const erpUsers = await getErpUsers(wanted);

    for (const email of wanted) {
      const p = existing.get(email);
      const erp = erpUsers.get(email);
      // Central roles (Finance, HQ, CS, ...) are not tied to a store: only "disabled in ERPNext" applies to them
      const central = !!p && p.role !== "associate" && p.role !== "manager";
      const branchIds = central ? [] : storesOf.get(email) ?? [];
      const shouldBeActive = !!erp?.enabled && (central || branchIds.length > 0) && !excluded.has(email);

      if (excluded.has(email) && !p) { s.skippedExcluded++; continue; }
      if (p && p.source !== "erpnext") continue; // manual accounts are managed by the admin only

      if (!p) {
        if (!shouldBeActive) continue;
        // New store staff member: no usable password until the admin issues one (Reset password)
        const { data: au, error } = await db.auth.admin.createUser({ email, password: randomBytes(24).toString("base64url"), email_confirm: true });
        if (error || !au.user) { s.errors.push(`create ${email}: ${error?.message ?? "failed"}`); continue; }
        const { error: pe } = await db.from("profiles").insert({
          id: au.user.id, full_name: erp!.fullName, email, role: "associate", source: "erpnext", erp_user: email,
          must_change_password: true, erp_synced_at: new Date().toISOString(), erp_created_run: run?.id ?? null,
        });
        if (pe) { await db.auth.admin.deleteUser(au.user.id); s.errors.push(`profile ${email}: ${pe.message}`); continue; }
        await db.from("user_branches").insert(branchIds.map((b) => ({ user_id: au.user.id, branch_id: b })));
        await audit("user_created", au.user.id, { email, role: "associate", branches: branchIds });
        s.usersCreated++;
        continue;
      }

      if (!shouldBeActive) {
        if (p.active) {
          await db.from("profiles").update({ active: false, deactivated_by_sync: true, erp_synced_at: new Date().toISOString() }).eq("id", p.id);
          await db.auth.admin.updateUserById(p.id, { ban_duration: "876000h" });
          await audit("user_deactivated", p.id, { reason: excluded.has(email) ? "excluded" : !erp?.enabled ? "disabled_in_erpnext" : "no_pandora_store" });
          s.usersDeactivated++;
        }
        continue;
      }

      // Active in ERPNext: keep the branch list in step (roles untouched)
      const { data: cur } = await db.from("user_branches").select("branch_id").eq("user_id", p.id);
      const have = new Set((cur ?? []).map((c) => c.branch_id));
      if (have.size !== branchIds.length || branchIds.some((b) => !have.has(b))) {
        await db.from("user_branches").delete().eq("user_id", p.id);
        await db.from("user_branches").insert(branchIds.map((b) => ({ user_id: p.id, branch_id: b })));
        await audit("branches_changed", p.id, { from: [...have], to: branchIds });
        s.usersUpdated++;
      }
      if (!p.active && p.deactivated_by_sync) {
        await db.from("profiles").update({ active: true, deactivated_by_sync: false }).eq("id", p.id);
        await db.auth.admin.updateUserById(p.id, { ban_duration: "none" });
        await audit("user_reactivated", p.id, {});
        s.usersReactivated++;
      }
      await db.from("profiles").update({ erp_synced_at: new Date().toISOString(), ...(p.name_locked ? {} : { full_name: erp!.fullName }) }).eq("id", p.id);
    }

    // ---- Sales persons (full runs only) ----
    if (!onlyEmail) await syncSalesPersons(db, run?.id ?? null, byProfile, s);
  } catch (e) {
    s.errors.push(e instanceof Error ? e.message : String(e));
  }

  if (run) await db.from("erp_sync_runs").update({ finished_at: new Date().toISOString(), ok: s.errors.length === 0, summary: s }).eq("id", run.id);
  return s;
}

const norm = (x: string) => x.toLowerCase().normalize("NFKD").replace(/[^a-z0-9؀-ۿ]+/g, " ").trim();

async function syncSalesPersons(
  db: ReturnType<typeof createAdminClient>, runId: number | null,
  byProfile: Map<string, { id: string; name: string }>, s: SyncSummary,
) {
  const people = await listSalesPersons();
  // ERPNext group name → branch ("Mall Of Egypt" matches "Mall of Egypt")
  const branchByName = new Map([...byProfile.values()].map((b) => [norm(b.name), b.id]));
  const { data: rows } = await db.from("sales_persons").select("erp_name, branch_id, branch_override, profile_id, enabled, erp_group, sync_paused");
  const have = new Map((rows ?? []).map((r) => [r.erp_name, r]));
  const { data: profiles } = await db.from("profiles").select("id, full_name");
  const profileByName = new Map((profiles ?? []).map((p) => [norm(p.full_name), p.id]));
  const now = new Date().toISOString();

  for (const sp of people) {
    const branchId = sp.group ? branchByName.get(norm(sp.group)) ?? null : null;
    const cur = have.get(sp.name);
    if (!cur) {
      await db.from("sales_persons").insert({
        erp_name: sp.name, erp_group: sp.group, branch_id: branchId, enabled: sp.enabled, created_run: runId,
        profile_id: profileByName.get(norm(sp.name)) ?? null, first_seen_at: now, last_seen_at: now,
      });
      s.salesPersonsNew++;
    } else if (cur.sync_paused) {
      await db.from("sales_persons").update({ last_seen_at: now }).eq("erp_name", sp.name); // admin stopped the sync for this person
    } else {
      const patch: Record<string, unknown> = { last_seen_at: now };
      if (cur.branch_id !== branchId || cur.erp_group !== sp.group) { patch.branch_id = branchId; patch.erp_group = sp.group; s.salesPersonsUpdated++; }
      if (cur.enabled !== sp.enabled) { patch.enabled = sp.enabled; if (!sp.enabled) s.salesPersonsDisabled++; }
      if (!cur.profile_id && profileByName.get(norm(sp.name))) patch.profile_id = profileByName.get(norm(sp.name));
      await db.from("sales_persons").update(patch).eq("erp_name", sp.name);
    }
    if (sp.enabled && !(cur?.branch_override ?? branchId)) s.salesPersonsUnallocated++;
  }
  // Gone from ERPNext → disabled here
  const seen = new Set(people.map((p) => p.name));
  for (const r of rows ?? []) {
    if (!seen.has(r.erp_name) && r.enabled && !r.sync_paused) {
      await db.from("sales_persons").update({ enabled: false }).eq("erp_name", r.erp_name);
      s.salesPersonsDisabled++;
    }
  }
}
