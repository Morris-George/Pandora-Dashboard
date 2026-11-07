import "server-only";

// ERPNext REST client (BRD 8A). Credentials stay server-side; the API user is read-only for Items.
const BASE = process.env.ERPNEXT_BASE_URL?.replace(/\/+$/, "");
const KEY = process.env.ERPNEXT_API_KEY;
const SECRET = process.env.ERPNEXT_API_SECRET;

export const erpConfigured = () => !!(BASE && KEY && SECRET);

function headers() {
  return { Authorization: `token ${KEY}:${SECRET}`, Accept: "application/json" };
}

async function get<T>(path: string): Promise<T | null> {
  const res = await fetch(`${BASE}${path}`, { headers: headers(), cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`ERPNext ${res.status}`);
  return (await res.json()).data as T;
}

export type ErpItem = {
  itemCode: string;
  itemName: string;
  description: string | null;
  barcode: string | null;
  image: string | null; // ERPNext file path, e.g. /files/abc.jpg
  itemGroup: string | null;
};

type RawItem = {
  name: string; item_name: string; description?: string; image?: string; item_group?: string;
  barcodes?: { barcode: string }[];
};

const stripHtml = (s?: string) => (s ? s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || null : null);

function toItem(r: RawItem): ErpItem {
  return {
    itemCode: r.name,
    itemName: r.item_name,
    description: stripHtml(r.description),
    barcode: r.barcodes?.[0]?.barcode ?? null,
    image: r.image || null,
    itemGroup: r.item_group ?? null,
  };
}

// Accepts an item code (SKU) or a barcode.
export async function findItem(code: string): Promise<ErpItem | null> {
  const c = code.trim();
  if (!c) return null;
  const byCode = await get<RawItem>(`/api/resource/Item/${encodeURIComponent(c)}`);
  if (byCode) return toItem(byCode);

  // Barcode table, then the Pandora SKU (e.g. 288307 or 580719-20), then the item name, which for
  // Pandora items is "<sku>-<EAN>" so a scanned EAN barcode matches its ending
  const tries = [
    [["Item Barcode", "barcode", "=", c]],
    [["sku", "=", c], ["has_variants", "=", 0]],
    [["sku", "=", c]],
    [["item_name", "like", `${c}-%`], ["has_variants", "=", 0]],
    [["item_name", "like", `%-${c}`]],
    [["item_name", "=", c]],
  ];
  for (const f of tries) {
    const hits = await get<{ name: string }[]>(`/api/resource/Item?filters=${encodeURIComponent(JSON.stringify(f))}&limit_page_length=1`).catch(() => null);
    if (!hits?.length) continue;
    const item = await get<RawItem>(`/api/resource/Item/${encodeURIComponent(hits[0].name)}`);
    if (item) return toItem(item);
  }
  return null;
}

// Selling price from the Pandora price list (ERPNext prices include 14% VAT; returned before VAT).
// null when there is no price or the API user may not read Item Price.
const PRICE_LIST = process.env.ERPNEXT_PRICE_LIST || "Pandora Standard Selling";
export async function getItemPrice(code: string): Promise<number | null> {
  const filters = encodeURIComponent(JSON.stringify([["item_code", "=", code], ["price_list", "=", PRICE_LIST]]));
  const fields = encodeURIComponent(JSON.stringify(["price_list_rate"]));
  const net = (rate: unknown) => (typeof rate === "number" && rate > 0 ? Math.round((rate / 1.14) * 100) / 100 : null);
  // ERPNext's own item-details lookup (what the POS uses) works with Item read access
  try {
    const res = await fetch(`${BASE}/api/method/erpnext.stock.get_item_details.get_item_details`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(8000),
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ args: {
        item_code: code, price_list: PRICE_LIST, company: process.env.ERPNEXT_COMPANY || "All-Niche", doctype: "Sales Invoice",
        currency: "EGP", price_list_currency: "EGP", conversion_rate: 1, plc_conversion_rate: 1, qty: 1, transaction_type: "selling",
      } }),
    });
    if (res.ok) {
      const price = net((await res.json()).message?.price_list_rate);
      if (price !== null) return price;
    }
  } catch { /* fall back to Item Price */ }
  try {
    const rows = await get<{ price_list_rate: number }[]>(`/api/resource/Item Price?filters=${filters}&fields=${fields}&limit_page_length=1`);
    return net(rows?.[0]?.price_list_rate);
  } catch {
    return null;
  }
}

// Fetches an ERPNext file (images can be private), only from /files or /private/files.
// Many Pandora items point at the product photo on the Shopify CDN instead; those are public and fetched without ERP credentials.
const IMAGE_HOSTS = ["cdn.shopify.com"];
export async function fetchErpFile(path: string): Promise<Response | null> {
  if (/^https:\/\//.test(path)) {
    const url = new URL(path);
    if (!IMAGE_HOSTS.includes(url.hostname)) return null;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return res.ok ? res : null;
  }
  if (!/^\/(private\/)?files\/[^?#]+$/.test(path) || path.includes("..")) return null;
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: headers().Authorization }, signal: AbortSignal.timeout(8000) });
  return res.ok ? res : null;
}

const q = (v: unknown) => encodeURIComponent(JSON.stringify(v));

// ---- Stores & store staff (Pandora only) ------------------------------------------------------
// A store is a POS Profile whose name starts with "Pandora"; its user list says who works there.
export const PANDORA_PREFIX = "Pandora";

export type ErpStore = { posProfile: string; warehouse: string | null; disabled: boolean; users: string[] };

export async function listPandoraStores(): Promise<ErpStore[]> {
  const rows = await get<{ name: string }[]>(
    `/api/resource/POS Profile?filters=${q([["name", "like", `${PANDORA_PREFIX}%`]])}&limit_page_length=100`);
  const out: ErpStore[] = [];
  for (const r of rows ?? []) {
    const p = await get<{ name: string; warehouse?: string; disabled?: number; applicable_for_users?: { user: string }[] }>(
      `/api/resource/POS Profile/${encodeURIComponent(r.name)}`);
    if (!p) continue;
    out.push({
      posProfile: p.name, warehouse: p.warehouse ?? null, disabled: !!p.disabled,
      users: [...new Set((p.applicable_for_users ?? []).map((u) => u.user.toLowerCase()))],
    });
  }
  return out;
}

export type ErpUser = { email: string; fullName: string; enabled: boolean };

export async function getErpUsers(emails: string[]): Promise<Map<string, ErpUser>> {
  const map = new Map<string, ErpUser>();
  for (let i = 0; i < emails.length; i += 100) {
    const chunk = emails.slice(i, i + 100);
    const rows = await get<{ name: string; full_name?: string; enabled?: number }[]>(
      `/api/resource/User?fields=${q(["name", "full_name", "enabled"])}&filters=${q([["name", "in", chunk]])}&limit_page_length=100`);
    (rows ?? []).forEach((u) => map.set(u.name.toLowerCase(), { email: u.name.toLowerCase(), fullName: u.full_name || u.name, enabled: !!u.enabled }));
  }
  return map;
}

// ---- Invoices --------------------------------------------------------------------------------
export type ErpInvoice = {
  name: string; postingDate: string; posProfile: string | null; customerName: string | null; mobile: string | null;
  isReturn: boolean; total: number; remarks: string | null; items: { itemCode: string; itemName: string; qty: number; barcode: string | null }[];
};

type RawInvoice = {
  name: string; posting_date: string; pos_profile?: string; customer_name?: string; contact_mobile?: string;
  is_return?: number; docstatus: number; grand_total?: number; remarks?: string; items?: { item_code: string; item_name: string; qty: number; barcode?: string }[];
};

const toInvoice = (r: RawInvoice): ErpInvoice => ({
  name: r.name, postingDate: r.posting_date, posProfile: r.pos_profile ?? null, customerName: r.customer_name ?? null,
  mobile: r.contact_mobile ?? null, isReturn: !!r.is_return, total: Number(r.grand_total ?? 0), remarks: r.remarks ?? null,
  items: (r.items ?? []).map((i) => ({ itemCode: i.item_code, itemName: i.item_name, qty: i.qty, barcode: i.barcode ?? null })),
});

// Submitted Pandora invoice by its number, or null
export async function getInvoice(no: string): Promise<ErpInvoice | null> {
  const r = await get<RawInvoice>(`/api/resource/Sales Invoice/${encodeURIComponent(no.trim())}`);
  if (!r || r.docstatus !== 1 || !(r.pos_profile ?? "").startsWith(PANDORA_PREFIX)) return null;
  return toInvoice(r);
}

// Pandora invoices for a customer's mobile that contain the item (newest first)
export async function findInvoices(mobile: string, itemCode: string): Promise<ErpInvoice[]> {
  // ERPNext stores numbers as plain digits, sometimes without the leading 0: match the last 9
  const digits = mobile.replace(/\D/g, "").slice(-9);
  if (digits.length < 9) return [];
  const rows = await get<{ name: string }[]>(`/api/resource/Sales Invoice?fields=${q(["name"])}&filters=${q([
    // The store filter is applied by getInvoice(): combined with the item join it returns nothing
    ["docstatus", "=", 1], ["is_return", "=", 0],
    ["contact_mobile", "like", `%${digits}`], ["Sales Invoice Item", "item_code", "=", itemCode.trim()],
  ])}&order_by=${encodeURIComponent("posting_date desc")}&limit_page_length=10`);
  const out: ErpInvoice[] = [];
  for (const r of rows ?? []) {
    const inv = await getInvoice(r.name);
    if (inv) out.push(inv);
  }
  return out;
}

// ---- Sales persons ------------------------------------------------------------------------------
// Leaf Sales Persons; the parent group is the store (e.g. "City Stars"), "Sales Team" is the root.
export type ErpSalesPerson = { name: string; group: string | null; enabled: boolean };

export async function listSalesPersons(): Promise<ErpSalesPerson[]> {
  const rows = await get<{ name: string; parent_sales_person?: string; enabled?: number; is_group?: number }[]>(
    `/api/resource/Sales Person?fields=${q(["name", "parent_sales_person", "enabled", "is_group"])}&limit_page_length=1000`);
  return (rows ?? []).filter((r) => !r.is_group).map((r) => ({ name: r.name, group: r.parent_sales_person || null, enabled: !!r.enabled }));
}

// Repair invoice issued in ERPNext that mentions the ticket number (remarks), newest first
// Finds the repair invoice by ticket no.: the "Maintenance Ticket" custom field (maintenance_ticket) first,
// then the remarks. If the custom field isn't on Sales Invoice yet, ERPNext rejects that filter and we use remarks only.
export async function findInvoiceByTicket(ticketNo: string): Promise<ErpInvoice | null> {
  const no = ticketNo.trim();
  const search = (filter: unknown[]) => get<{ name: string }[]>(`/api/resource/Sales Invoice?fields=${q(["name"])}&filters=${q([
    ["docstatus", "=", 1], filter,
  ])}&order_by=${encodeURIComponent("posting_date desc")}&limit_page_length=3`);
  const byField = await search(["maintenance_ticket", "=", no]).catch(() => null);
  const rows = byField?.length ? byField : await search(["remarks", "like", `%${no}%`]);
  for (const r of rows ?? []) {
    const inv = await getInvoice(r.name);
    if (inv) return inv;
  }
  return null;
}
