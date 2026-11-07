"use client";

import { withBase } from "@/lib/base";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { compressImage } from "@/lib/compress-image";
import { BarcodeScan } from "@/components/barcode-scan";
import { createClient } from "@/lib/supabase/client";
import { checkWarranty } from "@/lib/warranty";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { createDraft, findCustomer, findPreviousRepairs, lookupInvoice, lookupItem, submitTicket, type InvoiceLookup } from "./actions";

type Branch = { id: string; name: string };
type Category = { name: string; label: string; requiresComment: boolean; cost: number | null };

const DRAFT_KEY = "intake-draft";
const MIN_PHOTOS = 2;
const MAX_PHOTOS = 6;
const input = "rounded-lg border border-stone-300 px-3 py-2.5 font-normal focus:outline-2 focus:outline-stone-900";
const label = "flex flex-col gap-1.5 text-sm font-medium";

// 1500.00 → 1,500.00 for display; the stored value stays plain digits
const withCommas = (v: string) => { const [i, d] = v.split("."); return i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (d !== undefined ? "." + d : ""); };

async function sha256(file: File) {
  const buf = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function IntakeForm({ locale, branches, categories }: { locale: Locale; branches: Branch[]; categories: Category[] }) {
  const d = dictionaries[locale];
  const t = d.intake;
  const router = useRouter();
  const [branchId, setBranchId] = useState(branches[0].id);
  const [mobile, setMobile] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [known, setKnown] = useState(false);
  const [itemName, setItemName] = useState("");
  const [itemCode, setItemCode] = useState("");
  const [previous, setPrevious] = useState<{ ticketNo: string; date: string }[]>([]);
  const [itemDescription, setItemDescription] = useState("");
  const [itemBarcode, setItemBarcode] = useState("");
  const [itemImage, setItemImage] = useState("");
  const [lookupState, setLookupState] = useState<"" | "busy" | "found" | "not_found" | "not_connected" | "error">("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [noInvoice, setNoInvoice] = useState(false);
  const [inv, setInv] = useState<InvoiceLookup | { status: "busy" } | null>(null);
  const verified = inv?.status === "found";

  async function checkInvoice() {
    if (inv?.status === "busy") return;
    setInv({ status: "busy" });
    const r = await lookupInvoice({ invoiceNo, mobile, itemCode });
    if (r.status === "found") { setInvoiceNo(r.invoiceNo); setPurchaseDate(r.postingDate); }
    setInv(r);
  }
  const [fault, setFault] = useState("");
  const [notes, setNotes] = useState("");
  const [agreed, setAgreed] = useState("");
  const [accessories, setAccessories] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [step, setStep] = useState(0);
  const [restored, setRestored] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Saved draft: the typed fields survive a closed tab or reload on this device (photos are not kept)
  const fields = { branchId, mobile, fullName, email, itemName, itemCode, itemDescription, itemBarcode, itemImage, invoiceNo, purchaseDate, noInvoice, fault, notes, agreed, accessories, step };
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      const v = raw ? JSON.parse(raw) : null;
      if (v && Date.now() - v.savedAt < 24 * 3600_000 && (v.mobile || v.itemCode || v.itemName)) {
        if (branches.some((b) => b.id === v.branchId)) setBranchId(v.branchId);
        setMobile(v.mobile ?? ""); setFullName(v.fullName ?? ""); setEmail(v.email ?? "");
        setItemName(v.itemName ?? ""); setItemCode(v.itemCode ?? ""); setItemDescription(v.itemDescription ?? "");
        setItemBarcode(v.itemBarcode ?? ""); setItemImage(v.itemImage ?? ""); setInvoiceNo(v.invoiceNo ?? "");
        setPurchaseDate(v.purchaseDate ?? ""); setNoInvoice(!!v.noInvoice); setFault(v.fault ?? ""); setNotes(v.notes ?? "");
        setAgreed(v.agreed ?? ""); setAccessories(v.accessories ?? ""); setStep(Number(v.step) || 0);
        setRestored(true);
      }
    } catch { /* storage blocked: no draft */ }
    setLoaded(true);
  }, [branches]);
  const draftJson = JSON.stringify(fields);
  useEffect(() => {
    if (!loaded) return;
    const id = setTimeout(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...JSON.parse(draftJson), savedAt: Date.now() })); } catch { /* ignore */ } }, 500);
    return () => clearTimeout(id);
  }, [draftJson, loaded]);
  const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } };
  function startOver() {
    clearDraft();
    window.location.reload();
  }

  const previews = useMemo(() => photos.map((f) => URL.createObjectURL(f)), [photos]);
  const category = categories.find((c) => c.name === fault);
  // Warn when this customer brought the same item before
  useEffect(() => {
    if (mobile.replace(/\D/g, "").length < 9 || !itemCode.trim()) { setPrevious([]); return; }
    const id = setTimeout(() => { findPreviousRepairs(mobile, itemCode).then(setPrevious).catch(() => setPrevious([])); }, 400);
    return () => clearTimeout(id);
  }, [mobile, itemCode]);

  const w = checkWarranty(purchaseDate || null, noInvoice);
  const fmt = (dt: Date) => dt.toLocaleDateString(locale === "ar" ? "ar-EG" : "en-GB", { day: "numeric", month: "long", year: "numeric" });
  const banner =
    noInvoice ? { cls: "bg-amber-50 border-amber-300 text-amber-900", text: t.wNoInvoice }
    : w.result === "under_warranty" ? { cls: "bg-emerald-50 border-emerald-300 text-emerald-900", text: t.wIn(fmt(w.expires!), w.daysLeft!) }
    : w.result === "out_of_warranty" ? { cls: "bg-amber-50 border-amber-300 text-amber-900", text: t.wOut(fmt(w.expires!)) }
    : { cls: "bg-stone-50 border-stone-200 text-stone-700", text: t.wPending };

  const stepMissing: string[][] = [[], [], [], []];
  if (!/^[0-9+]{8,15}$/.test(mobile)) stepMissing[0].push(t.need.mobile);
  if (fullName.trim().length < 2) stepMissing[0].push(t.need.name);
  if (itemName.trim().length < 2) stepMissing[1].push(t.need.item);
  if (!fault) stepMissing[2].push(t.need.fault);
  if (category?.requiresComment && !notes.trim()) stepMissing[2].push(t.need.comment);
  if (photos.length < MIN_PHOTOS) stepMissing[3].push(t.need.photos(MIN_PHOTOS - photos.length));
  const missing = stepMissing.flat();
  const STEPS = [t.steps.customer, t.steps.item, t.steps.fault, t.steps.photos];
  const show = (n: number) => (step === n ? "" : "hidden ");

  async function lookupCustomer() {
    const c = await findCustomer(mobile);
    setKnown(!!c);
    if (c) { setFullName(c.full_name); setEmail(c.email ?? ""); }
  }

  // Details that came from ERPNext can't be changed by hand
  const erpLocked = lookupState === "found";
  const lockedCls = "bg-stone-100 text-stone-700 cursor-not-allowed";

  async function lookup(code = itemCode) {
    if (!code.trim() || lookupState === "busy") return;
    setLookupState("busy");
    const r = await lookupItem(code);
    if (r.status === "found") {
      setItemCode(r.itemCode);
      setItemName(r.itemName);
      setItemDescription(r.description ?? "");
      setItemBarcode(r.barcode ?? "");
      setItemImage(r.image ?? "");
    } else {
      setItemImage("");
    }
    setLookupState(r.status);
  }

  // Look the code up by itself once typing stops (scanners that send no Enter, or a pasted code)
  useEffect(() => {
    if (lookupState || itemCode.trim().length < 4) return;
    const timer = setTimeout(() => lookup(), 700);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemCode, lookupState]);

  function addPhotos(list: FileList | null) {
    // Copy now: the input is cleared right after, which empties the live FileList
    const files = Array.from(list ?? []);
    if (!files.length) return;
    setPhotos((p) => [...p, ...files].slice(0, MAX_PHOTOS));
  }

  async function submit() {
    setError("");
    setBusy(t.creating);
    const draft = await createDraft({
      branchId, mobile, fullName, email, itemName, itemCode, itemDescription, itemBarcode, itemImage, noInvoice,
      invoiceNo: noInvoice ? "" : invoiceNo, purchaseDate: noInvoice ? "" : purchaseDate,
      faultCategory: fault, faultNotes: notes, accessories, agreedAmount: agreed,
    });
    if (!draft.ticketId) { setBusy(""); setError(draft.error ?? t.errCreate); return; }

    const supabase = createClient();
    for (let i = 0; i < photos.length; i++) {
      setBusy(t.uploading(i + 1, photos.length));
      const f = await compressImage(photos[i]);
      const ext = (f.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${draft.ticketId}/intake-${i + 1}-${Date.now()}.${ext}`;
      const up = await supabase.storage.from("ticket-media").upload(path, f, { contentType: f.type || "image/jpeg" });
      if (up.error) { setBusy(""); setError(t.errUpload(i + 1, up.error.message)); return; }
      const row = await supabase.from("ticket_media").insert({ ticket_id: draft.ticketId, stage: "intake", storage_path: path, file_hash: await sha256(f) });
      if (row.error) { setBusy(""); setError(t.errRecord(i + 1, row.error.message)); return; }
    }

    setBusy(t.finalising);
    const done = await submitTicket(draft.ticketId);
    if (done.error) { setBusy(""); setError(done.error); return; }
    clearDraft();
    router.push(`/tickets/${draft.ticketId}?created=1`);
  }

  return (
    <section className="bg-white rounded-2xl border border-stone-200 p-6 flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">{t.title}</h1>
        <p className="text-sm text-stone-600 mt-1">{t.stage}</p>
      </div>

      {restored && (
        <p role="status" className="rounded-lg bg-sky-50 border border-sky-200 text-sky-900 text-sm p-3 flex flex-wrap items-center gap-3">
          {t.draftRestored}
          <button type="button" onClick={startOver} className="underline font-semibold">{t.startOver}</button>
        </p>
      )}

      <ol className="grid grid-cols-4 gap-2" aria-label={t.stepsLabel}>
        {STEPS.map((label, n) => {
          const done = !stepMissing[n].length;
          // A later step opens only when every step before it is complete
          const locked = n > step && stepMissing.slice(0, n).some((m) => m.length);
          return (
            <li key={n}>
              <button type="button" onClick={() => setStep(n)} disabled={locked} aria-current={step === n ? "step" : undefined}
                className={`w-full rounded-xl border px-2 py-2.5 text-xs sm:text-sm font-semibold flex flex-col sm:flex-row items-center justify-center gap-1.5 transition disabled:opacity-50 disabled:cursor-not-allowed
                  ${step === n ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--on-accent)] shadow-sm" : done ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-stone-200 bg-white text-stone-600"}`}>
                <span className={`grid place-items-center w-6 h-6 rounded-full text-xs ${step === n ? "bg-white/30" : done ? "bg-emerald-600 text-white" : "bg-stone-100"}`}>{done && step !== n ? "✓" : n + 1}</span>
                {label}
              </button>
            </li>
          );
        })}
      </ol>

      {branches.length > 1 && (
        <label className={`${show(0)}${label}`}>{t.branch}
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={input}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
      )}

      <fieldset className={`${show(0)}grid grid-cols-1 sm:grid-cols-3 gap-4`}>
        <legend className="text-sm font-semibold mb-2">{t.customer}</legend>
        <label className={label}>{t.mobile}
          <input value={mobile} onChange={(e) => setMobile(e.target.value.trim())} onBlur={lookupCustomer}
            inputMode="tel" dir="ltr" placeholder="01xxxxxxxxx" className={input} />
        </label>
        <label className={label}>{t.fullName}
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={input} />
        </label>
        <label className={label}>{t.email}
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" dir="ltr" className={input} />
        </label>
        {known && <p className="sm:col-span-3 text-sm text-emerald-800">{t.known}</p>}
      </fieldset>

      <fieldset className={`${show(1)}grid grid-cols-1 sm:grid-cols-2 gap-4`}>
        <legend className="text-sm font-semibold mb-2">{t.itemSection}</legend>
        <div className="sm:col-span-2 flex flex-col gap-1.5">
          <label htmlFor="sku" className="text-sm font-medium">{t.itemCode}</label>
          <div className="flex gap-2">
            <input id="sku" value={itemCode} dir="ltr" placeholder={t.itemCodePh} className={`${input} flex-1 min-w-0`}
              onChange={(e) => { setItemCode(e.target.value); setLookupState(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); lookup(); } }}
              onBlur={() => { if (itemCode.trim() && !lookupState) lookup(); }} />
            <BarcodeScan label={t.scan} title={t.scanTitle} cancel={t.scanCancel} denied={t.scanDenied}
              onResult={(code) => { setItemCode(code); setLookupState(""); lookup(code); }} />
            <button type="button" onClick={() => lookup()} disabled={!itemCode.trim() || lookupState === "busy"}
              className="rounded-lg border border-stone-900 px-4 text-sm font-medium disabled:opacity-40">
              {lookupState === "busy" ? t.lookingUp : t.lookup}
            </button>
          </div>
          {lookupState === "found" && <p className="text-sm text-emerald-800">{t.itemFound}</p>}
          {lookupState === "not_found" && <p className="text-sm text-amber-800">{t.itemNotFound}</p>}
          {lookupState === "not_connected" && <p className="text-sm text-stone-600">{t.itemNotConnected}</p>}
          {lookupState === "error" && <p role="alert" className="text-sm text-red-800">{t.itemError}</p>}
        </div>
        {itemImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={withBase(`/api/erp-image?path=${encodeURIComponent(itemImage)}`)} alt={t.itemImageAlt}
            className="sm:row-span-2 h-40 w-40 object-contain rounded-lg border border-stone-200 bg-stone-50" />
        )}
        <label className={label}>{t.item}
          <input value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder={t.itemPh} readOnly={erpLocked} className={`${input} ${erpLocked ? lockedCls : ""}`} />
        </label>
        <label className={label}>{t.barcode}
          <input value={itemBarcode} onChange={(e) => setItemBarcode(e.target.value)} dir="ltr" readOnly={erpLocked} className={`${input} ${erpLocked ? lockedCls : ""}`} />
        </label>
        {(itemDescription || lookupState === "found") && (
          <label className={`${label} sm:col-span-2`}>{t.itemDescription}
            <textarea value={itemDescription} onChange={(e) => setItemDescription(e.target.value)} rows={2} readOnly={erpLocked} className={`${input} ${erpLocked ? lockedCls : ""}`} />
          </label>
        )}
        <label className="sm:col-span-2 flex items-center gap-2 text-sm font-medium cursor-pointer">
          <input type="checkbox" checked={noInvoice} onChange={(e) => setNoInvoice(e.target.checked)} className="h-5 w-5" />
          {t.noInvoice}
        </label>
        {!noInvoice && (
          <>
            <label className={label}>{t.invoice}
              <span className="flex gap-2">
                <input value={invoiceNo} onChange={(e) => { setInvoiceNo(e.target.value); setInv(null); }} dir="ltr" placeholder="ONL-INV-…" className={`${input} flex-1 min-w-0`}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); checkInvoice(); } }} />
                <button type="button" onClick={checkInvoice} disabled={inv?.status === "busy" || (!invoiceNo.trim() && !(mobile && itemCode))}
                  className="rounded-lg border border-stone-300 bg-white px-3 text-sm font-semibold whitespace-nowrap disabled:opacity-40">
                  {inv?.status === "busy" ? t.inv.checking : invoiceNo.trim() ? t.inv.check : t.inv.find}
                </button>
              </span>
            </label>
            <label className={label}>{t.purchaseDate}
              <input value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} type="date" readOnly={verified}
                max={new Date().toISOString().slice(0, 10)} className={`${input} ${verified ? "bg-emerald-50" : ""}`} />
            </label>
            {inv && inv.status !== "busy" && (
              <p className={`sm:col-span-2 text-sm rounded-lg p-2.5 ${inv.status === "found" ? (inv.hasItem ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900") : "bg-stone-50 text-stone-700"}`}>
                {inv.status === "found"
                  ? `${t.inv.found(inv.invoiceNo, inv.postingDate, (inv.store ?? "").replace(/^Pandora\s+/, ""))}${inv.hasItem ? "" : " " + t.inv.itemMissing}`
                  : t.inv[inv.status]}
              </p>
            )}
          </>
        )}
        <div role="status" aria-live="polite" className={`sm:col-span-2 rounded-lg border p-3 text-sm ${banner.cls}`}>
          <strong>{d.warranty[w.result]}</strong> — {banner.text}
          <div className="text-xs opacity-80 mt-1">{t.wRule}</div>
        </div>
      </fieldset>

      <fieldset className={`${show(2)}flex flex-col gap-3`}>
        <legend className="text-sm font-semibold mb-2">{t.fault}</legend>
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <button key={c.name} type="button" onClick={() => { setFault(c.name); if (c.cost !== null) setAgreed(Math.round(c.cost).toFixed(2)); }} aria-pressed={fault === c.name}
              className={`rounded-full border border-stone-900 px-4 py-2 text-sm ${fault === c.name ? "bg-[var(--accent)] text-[var(--on-accent)]" : "bg-white"}`}>
              {c.label}
            </button>
          ))}
        </div>
        <label className={label}>
          {category?.requiresComment ? t.commentRequired(category.label) : t.commentOptional}
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder={t.commentPh} className={input} />
        </label>
        <label className={label}>{t.agreedAmount}
          <input value={withCommas(agreed)} onChange={(e) => setAgreed(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" dir="ltr" placeholder="0" className={`${input} max-w-48`} />
          <span className="text-xs text-stone-500 font-normal">{t.agreedHint}</span>
          {category?.cost != null && <span className="text-xs text-emerald-800 font-normal">{t.standardCost(withCommas(Math.round(category.cost).toFixed(2)))}</span>}
        </label>
        {!!previous.length && (
          <p role="alert" className="rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm p-3">
            {t.repeatWarn(previous.map((x) => `${x.ticketNo} (${x.date})`).join(", "))}
          </p>
        )}
        <label className={label}>{t.accessories}
          <input value={accessories} onChange={(e) => setAccessories(e.target.value)} placeholder={t.accessoriesPh} className={input} />
        </label>
      </fieldset>

      <fieldset className={`${show(3)}flex flex-col gap-3`}>
        <legend className="text-sm font-semibold mb-2">{t.photos} <span className="font-normal text-stone-600">{t.photosHint(MIN_PHOTOS, MAX_PHOTOS)}</span></legend>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {previews.map((src, i) => (
            <div key={src} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={t.photoAlt(i + 1)} className="h-28 w-full object-cover rounded-lg border border-stone-200" />
              <button type="button" onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))} aria-label={t.removePhoto(i + 1)}
                className="absolute top-1 end-1 rounded-full bg-white/90 w-7 h-7 text-sm border border-stone-300">×</button>
            </div>
          ))}
          {photos.length < MAX_PHOTOS && (
            <div className="h-28 grid grid-rows-2 gap-2">
              <label className="rounded-lg border border-dashed border-stone-400 flex items-center justify-center text-sm font-medium text-stone-700 cursor-pointer bg-stone-50 hover:bg-stone-100">
                {t.takePhoto}
                <input type="file" accept="image/*" capture="environment" multiple className="sr-only"
                  onChange={(e) => { addPhotos(e.target.files); e.target.value = ""; }} />
              </label>
              <label className="rounded-lg border border-dashed border-stone-400 flex items-center justify-center text-sm font-medium text-stone-700 cursor-pointer bg-white hover:bg-stone-50 text-center px-1">
                {t.addPhoto}
                <input type="file" accept="image/*" multiple className="sr-only"
                  onChange={(e) => { addPhotos(e.target.files); e.target.value = ""; }} />
              </label>
            </div>
          )}
        </div>
      </fieldset>

      {error && <p role="alert" className="text-sm text-red-800 bg-red-50 rounded-lg p-3">{error}</p>}

      <div className="sticky bottom-0 z-10 -mx-6 -mb-6 px-6 py-4 rounded-b-2xl bg-white/95 backdrop-blur flex flex-wrap items-center gap-3 border-t border-stone-200">
        {step > 0 && (
          <button type="button" onClick={() => setStep(step - 1)} className="rounded-lg border border-stone-900 px-4 py-3 font-semibold">{t.back}</button>
        )}
        {step < 3 ? (
          <button type="button" disabled={stepMissing[step].length > 0} onClick={() => { setStep(step + 1); window.scrollTo({ top: 0, behavior: "smooth" }); }}
            className="rounded-lg bg-[var(--accent)] text-[var(--on-accent)] px-5 py-3 font-semibold disabled:opacity-40">{t.next}</button>
        ) : (
          <button type="button" onClick={submit} disabled={missing.length > 0 || !!busy}
            className="rounded-lg bg-[var(--accent)] text-[var(--on-accent)] px-5 py-3 font-semibold disabled:opacity-40">
            {busy || t.create}
          </button>
        )}
        <span className="text-sm text-stone-600">
          {(step < 3 ? stepMissing[step] : missing).length
            ? `${t.stillNeeded} ${(step < 3 ? stepMissing[step] : missing).join(locale === "ar" ? "، " : ", ")}`
            : step < 3 ? t.stepDone : t.ready}
        </span>
      </div>
    </section>
  );
}
