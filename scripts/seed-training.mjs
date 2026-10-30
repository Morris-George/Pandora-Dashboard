// Training accounts on the live system: one per role, all limited to the training store "فرع تدريب".
// Passwords are written to training-accounts.local.txt (git-ignored); hand them to the team privately.
// Usage: node --env-file=.env.local scripts/seed-training.mjs
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const OUT = "training-accounts.local.txt";
const STATE = "supabase/training-users.local.json";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// key, role, Arabic label, gets the training store
const USERS = [
  ["associate", "associate", "موظف فرع", true],
  ["manager", "manager", "مدير فرع", true],
  ["manager2", "manager", "مدير فرع تاني (للموافقة على الشحن)", true],
  ["area", "courier", "مدير المنطقة", false],
  ["hq", "hq", "استلام المركز الرئيسي", false],
  ["technician", "technician", "فني", false],
  ["supervisor", "supervisor", "مشرف الصيانة", false],
  ["cs", "cs", "خدمة العملاء", false],
  ["finance", "finance", "الحسابات", false],
  ["ops", "ops", "مدير العمليات", false],
];

const saved = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
const { data: trn } = await db.from("branches").select("id").eq("code", "TRN").single();
const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });

const lines = ["حسابات التدريب — Pandora Maintenance", "الرابط: https://pandora-maintenance.vercel.app", ""];
for (const [key, role, label, store] of USERS) {
  const email = `training.${key}@training.pandoraeg.com`;
  const password = saved[key]?.password ?? `Trn-${randomBytes(6).toString("base64url")}`;
  let user = list.users.find((u) => u.email === email);
  if (!user) {
    const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(`${email}: ${error.message}`);
    user = data.user;
  } else {
    await db.auth.admin.updateUserById(user.id, { password });
  }
  const { error: pe } = await db.from("profiles").upsert({
    id: user.id, full_name: `تدريب — ${label}`, email, role, active: true, is_training: true, must_change_password: false, name_locked: true,
  });
  if (pe) throw new Error(`${email}: ${pe.message}`);
  await db.from("user_branches").delete().eq("user_id", user.id);
  if (store) await db.from("user_branches").insert({ user_id: user.id, branch_id: trn.id });
  saved[key] = { email, password, role };
  lines.push(`${label}\n  ${email}\n  ${password}\n`);
  console.log(`ok  ${key.padEnd(11)} ${role}`);
}
writeFileSync(STATE, JSON.stringify(saved, null, 2));
writeFileSync(OUT, lines.join("\n"));
console.log(`\nAccounts written to ${OUT}`);
