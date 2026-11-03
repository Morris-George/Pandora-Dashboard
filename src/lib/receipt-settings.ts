// Receipt layout chosen in Admin → Receipt. Empty texts fall back to the built-in wording.
export type Bilingual = { ar: string; en: string };
export type ReceiptSettings = {
  logo: "pandora" | "custom" | "none";
  customLogo: string; // data: URL (PNG/JPG, small, black on white prints best)
  storeLine: string; // e.g. company name / tax number
  phone: string;
  website: string;
  showMobile: boolean;
  showItemCode: boolean;
  showQr: boolean;
  showAgreed: boolean;
  showCustomer: boolean;
  showFault: boolean;
  showAccessories: boolean;
  showWhatsapp: boolean;
  showScanText: boolean;
  showTerms: boolean;
  showSignature: boolean;
  showFooter: boolean;
  termsIntake: Bilingual;
  termsDelivery: Bilingual;
  footer: Bilingual;
  labelWidth: number; // bag label size in mm (label printer)
  labelHeight: number;
};

export const RECEIPT_DEFAULTS: ReceiptSettings = {
  logo: "pandora", customLogo: "", storeLine: "", phone: "", website: "",
  showMobile: true, showItemCode: true, showQr: true, showAgreed: true,
  showCustomer: true, showFault: true, showAccessories: true, showWhatsapp: true,
  showScanText: true, showTerms: true, showSignature: false, showFooter: true, // signature line off by default
  termsIntake: { ar: "", en: "" }, termsDelivery: { ar: "", en: "" }, footer: { ar: "", en: "" },
  labelWidth: 50, labelHeight: 30,
};

export function withDefaults(v: unknown): ReceiptSettings {
  const s = (v && typeof v === "object" ? v : {}) as Partial<ReceiptSettings>;
  return {
    ...RECEIPT_DEFAULTS, ...s,
    termsIntake: { ...RECEIPT_DEFAULTS.termsIntake, ...s.termsIntake },
    termsDelivery: { ...RECEIPT_DEFAULTS.termsDelivery, ...s.termsDelivery },
    footer: { ...RECEIPT_DEFAULTS.footer, ...s.footer },
    labelWidth: Math.min(120, Math.max(20, Number(s.labelWidth) || RECEIPT_DEFAULTS.labelWidth)),
    labelHeight: Math.min(100, Math.max(10, Number(s.labelHeight) || RECEIPT_DEFAULTS.labelHeight)),
  };
}
