// Creates one test user per role (idempotent). Credentials are written to
// supabase/test-users.local.json (git-ignored) — never commit or share it.
// Usage: node --env-file=.env.local scripts/seed-test-users.mjs
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const OUT = "supabase/test-users.local.json";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// role -> branch codes (branch roles only)
const USERS = [
  ["associate", ["CS"]], ["manager", ["CS"]], ["associate2", ["MOE"], "associate"],
  ["courier", []], ["hq", []], ["technician", []], ["supervisor", []],
  ["cs", []], ["finance", []], ["ops", []], ["admin", []],
];

const saved = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
const { data: branches } = await admin.from("branches").select("id, code");
const branchId = Object.fromEntries(branches.map((b) => [b.code, b.id]));
const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 });

for (const [key, codes, roleOverride] of USERS) {
  const role = roleOverride ?? key;
  const email = `test.${key}@pandora-maintenance.test`;
  const password = saved[key]?.password ?? randomBytes(12).toString("base64url");
  let user = list.users.find((u) => u.email === email);
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(`${email}: ${error.message}`);
    user = data.user;
  }
  await admin.from("profiles").upsert({ id: user.id, full_name: `Test ${key}`, email, role, active: true });
  await admin.from("user_branches").delete().eq("user_id", user.id);
  if (codes.length) await admin.from("user_branches").insert(codes.map((c) => ({ user_id: user.id, branch_id: branchId[c] })));
  saved[key] = { email, password, role, branches: codes };
  console.log(`ok  ${key.padEnd(11)} ${role.padEnd(11)} ${codes.join(",") || "-"}`);
}
writeFileSync(OUT, JSON.stringify(saved, null, 2));
console.log(`\nCredentials saved to ${OUT}`);
