"use server";

import { after } from "next/server";
import { flushEmails } from "@/lib/email";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { provisionalWarranty } from "@/lib/warranty";
import { getI18n } from "@/lib/i18n";
import { erpConfigured, findInvoices, findItem, getInvoice } from "@/lib/erpnext";

const MOBILE = /^[0-9+]{8,15}$/;

// Same rule as norm_mobile() in the database: one customer per number, whatever the format
const normMobile = (m: string) => {
  const d = m.replace(/\D/g, "");
  if (/^(0020|20)1\d{9}$/.test(d)) return "0" + d.slice(-10);
  if (/^1\d{9}$/.test(d)) return "0" + d;
  return d;
};

export async function findCustomer(mobile: string) {
  await requireRole("associate", "manager");
  if (!MOBILE.test(mobile.trim())) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("customers").select("full_name, email").eq("mobile", normMobile(mobile)).maybeSingle();
  return data;
}

export type ItemLookup =
  | { status: "found"; itemCode: string; itemName: string; description: string | null; barcode: string | null; image: string | null }
  | { status: "not_found" | "not_connected" | "error" };

// SKU or barcode → item details from ERPNext
export async function lookupItem(code: string): Promise<ItemLookup> {
  await requireRole("associate", "manager");
  if (!erpConfigured()) return { status: "not_connected" };
  try {
    const item = await findItem(code.slice(0, 60));
    if (!item) return { status: "not_found" };
    return { status: "found", itemCode: item.itemCode, itemName: item.itemName, description: item.description, barcode: item.barcode, image: item.image };
  } catch {
    return { status: "error" };
  }
}

export type InvoiceLookup =
  | { status: "found"; invoiceNo: string; postingDate: string; store: string | null; hasItem: boolean; customerName: string | null }
  | { status: "not_found" | "not_connected" | "error" };

// Invoice check against ERPNext: by number, or by the customer's mobile + SKU when the number is unknown
export async function lookupInvoice(input: { invoiceNo?: string; mobile?: string; itemCode?: string }): Promise<InvoiceLookup> {
  await requireRole("associate", "manager");
  if (!erpConfigured()) return { status: "not_connected" };
  try {
    const no = input.invoiceNo?.trim().slice(0, 60);
    const code = input.itemCode?.trim().slice(0, 60) ?? "";
    let inv = no ? await getInvoice(no) : null;
    if (!inv && !no && input.mobile && code) inv = (await findInvoices(input.mobile, code))[0] ?? null;
    if (!inv) return { status: "not_found" };
    return {
      status: "found", invoiceNo: inv.name, postingDate: inv.postingDate, store: inv.posProfile, customerName: inv.customerName,
      hasItem: !code || inv.items.some((i) => i.itemCode === code || i.barcode === code),
    };
  } catch {
    return { status: "error" };
  }
}

const DraftInput = z.object({
  branchId: z.string().uuid(),
  mobile: z.string().trim().regex(MOBILE, "Enter a valid mobile number").transform(normMobile),
  fullName: z.string().trim().min(2, "Enter the customer name").max(120),
  email: z.string().trim().email("Invalid email").max(160).optional().or(z.literal("")),
  itemName: z.string().trim().min(2, "Enter the item").max(160),
  itemCode: z.string().trim().max(60).optional(),
  itemDescription: z.string().trim().max(2000).optional(),
  itemBarcode: z.string().trim().max(60).optional(),
  itemImage: z.string().regex(/^\/(private\/)?files\/[^?#]+$/).max(300).optional().or(z.literal("")),
  invoiceNo: z.string().trim().max(60).optional(),
  purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  noInvoice: z.boolean().default(false),
  faultCategory: z.string().min(1, "Choose a fault category"),
  faultNotes: z.string().trim().max(2000).optional(),
  agreedAmount: z.string().trim().regex(/^\d{0,7}(\.\d{1,2})?$/).optional(),
  accessories: z.string().trim().max(500).optional(),
});
export type DraftInput = z.infer<typeof DraftInput>;

// Step 1: create the customer (if new) and a draft ticket. Photos are uploaded next, then submitTicket().
export async function createDraft(input: DraftInput): Promise<{ ticketId?: string; error?: string }> {
  const session = await requireRole("associate", "manager");
  const { t } = await getI18n();
  const parsed = DraftInput.safeParse(input);
  if (!parsed.success) return { error: t.intake.errInvalid(parsed.error.issues.map((i) => String(i.path[0])).join(", ")) };
  const d = parsed.data;
  if (!session.branches.some((b) => b.id === d.branchId)) return { error: t.intake.errBranch };

  const supabase = await createClient();
  const { data: cat } = await supabase.from("fault_categories").select("requires_comment, active").eq("name", d.faultCategory).maybeSingle();
  if (!cat?.active) return { error: t.intake.errCategory };
  if (cat.requires_comment && !d.faultNotes) return { error: t.intake.commentRequired(d.faultCategory) };

  let { data: customer } = await supabase.from("customers").select("id").eq("mobile", d.mobile).maybeSingle();
  if (!customer) {
    const ins = await supabase.from("customers")
      .insert({ full_name: d.fullName, mobile: d.mobile, email: d.email || null }).select("id").single();
    if (ins.error) return { error: t.intake.errCustomer };
    customer = ins.data;
  }

  // Re-check the invoice on the server: a verified ERPNext invoice sets the purchase date (warranty basis)
  let purchaseDate = d.purchaseDate;
  let verified = false;
  if (!d.noInvoice && d.invoiceNo && erpConfigured()) {
    const inv = await getInvoice(d.invoiceNo).catch(() => null);
    if (inv) { purchaseDate = inv.postingDate; verified = true; }
  }

  const { data: ticket, error } = await supabase.from("tickets").insert({
    customer_id: customer.id,
    branch_id: d.branchId,
    item_name: d.itemName,
    item_code: d.itemCode || null,
    item_description: d.itemDescription || null,
    item_barcode: d.itemBarcode || null,
    item_image: d.itemImage || null,
    no_invoice: d.noInvoice,
    invoice_verified: verified,
    erp_sales_invoice: d.noInvoice ? null : d.invoiceNo || null,
    purchase_date: d.noInvoice ? null : purchaseDate || null,
    fault_category: d.faultCategory,
    fault_notes: d.faultNotes || null,
    agreed_amount: d.agreedAmount ? Number(d.agreedAmount) : null, // customer pre-agreed max cost
    accessories: d.accessories || null,
    warranty_provisional: provisionalWarranty(purchaseDate || null, d.noInvoice),
  }).select("id").single();
  if (error) return { error: t.intake.errCreate };
  return { ticketId: ticket.id };
}

// Step 3: after photos are stored, move the ticket out of draft (DB enforces ≥2 intake photos).
export async function submitTicket(ticketId: string): Promise<{ error?: string }> {
  await requireRole("associate", "manager");
  const { t } = await getI18n();
  const supabase = await createClient();
  after(() => flushEmails()); // send any customer email this queues
  const { error } = await supabase.rpc("transition_ticket", { p_ticket: ticketId, p_to: "received_at_branch" });
  if (!error) return {};
  return { error: error.message.includes("photos") ? t.intake.errPhotos : t.intake.errCreate };
}
