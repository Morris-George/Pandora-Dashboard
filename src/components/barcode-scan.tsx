"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/dialog";

// Reads a barcode / QR with the tablet's back camera and returns its text once
export function BarcodeScan({ label, title, cancel, denied, onResult }: {
  label: string; title: string; cancel: string; denied: string; onResult: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const cb = useRef(onResult);
  useEffect(() => { cb.current = onResult; });

  useEffect(() => {
    if (!open) return;
    let stop: (() => void) | null = null;
    let done = false;
    setError("");
    (async () => {
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      if (done || !video.current) return;
      try {
        const controls = await new BrowserMultiFormatReader().decodeFromConstraints(
          { video: { facingMode: "environment" } }, video.current,
          (result) => {
            if (!result || done) return;
            done = true;
            stop?.();
            navigator.vibrate?.(60);
            setOpen(false);
            cb.current(result.getText().trim());
          });
        stop = () => controls.stop();
        if (done) controls.stop();
      } catch {
        setError(denied);
      }
    })();
    return () => { done = true; stop?.(); };
  }, [open, denied]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg border border-stone-900 px-3 text-sm font-medium whitespace-nowrap">
        {label}
      </button>
      <Dialog open={open} title={title} onClose={() => setOpen(false)}>
        <video ref={video} muted playsInline className="w-full aspect-[4/3] rounded-lg bg-black object-cover" />
        {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
        <button type="button" onClick={() => setOpen(false)} className="self-end rounded-lg border border-stone-300 px-4 py-2 text-sm">{cancel}</button>
      </Dialog>
    </>
  );
}
