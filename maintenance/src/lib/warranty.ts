// Provisional warranty at intake (BRD Stage 1). The final decision is the technician's at HQ.
// Policy: warranty = 1 year from the purchase date on the original invoice.
export const WARRANTY_MONTHS = 12;

export type Warranty = "under_warranty" | "out_of_warranty" | "pending_assessment";

export type WarrantyCheck = { result: Warranty; expires: Date | null; daysLeft: number | null };

export function checkWarranty(purchaseDate: string | null, noInvoice: boolean, today = new Date()): WarrantyCheck {
  // No proof of purchase → treated as out of warranty; HQ may override with a reason
  if (noInvoice) return { result: "out_of_warranty", expires: null, daysLeft: null };
  if (!purchaseDate) return { result: "pending_assessment", expires: null, daysLeft: null };
  const expires = new Date(purchaseDate);
  if (Number.isNaN(expires.getTime())) return { result: "pending_assessment", expires: null, daysLeft: null };
  expires.setMonth(expires.getMonth() + WARRANTY_MONTHS);
  const daysLeft = Math.ceil((expires.getTime() - today.getTime()) / 86_400_000);
  return { result: daysLeft >= 0 ? "under_warranty" : "out_of_warranty", expires, daysLeft };
}

export const provisionalWarranty = (purchaseDate: string | null, noInvoice = false) =>
  checkWarranty(purchaseDate, noInvoice).result;
