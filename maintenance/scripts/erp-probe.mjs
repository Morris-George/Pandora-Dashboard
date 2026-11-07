// Read-only check of what the ERPNext API user can see. Prints access + counts only (no personal data).
// Usage: node --env-file=.env.local scripts/erp-probe.mjs
const base = process.env.ERPNEXT_BASE_URL, auth = `token ${process.env.ERPNEXT_API_KEY}:${process.env.ERPNEXT_API_SECRET}`;
const get = async (path) => {
  const r = await fetch(base + path, { headers: { Authorization: auth, Accept: "application/json" } });
  return { status: r.status, body: r.ok ? await r.json() : null };
};
const me = await get("/api/method/frappe.auth.get_logged_user");
console.log("login:", me.status, me.body ? "OK" : "FAILED");
for (const dt of ["Warehouse", "Branch", "POS Profile", "Company", "Employee", "User", "Sales Person", "Customer", "Sales Invoice", "POS Invoice", "Item", "Payment Entry"]) {
  const c = await get(`/api/method/frappe.client.get_count?doctype=${encodeURIComponent(dt)}`);
  console.log(`${dt.padEnd(14)} ${c.status === 200 ? "read OK  count=" + c.body.message : "no access (" + c.status + ")"}`);
}
