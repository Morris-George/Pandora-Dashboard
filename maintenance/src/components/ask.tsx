"use client";

import { useCallback, useRef, useState } from "react";
import { Dialog } from "@/components/dialog";

type AskOptions = {
  title: string;
  message?: string;
  input?: boolean; // ask for a value (otherwise a yes / no question)
  optional?: boolean; // the value may be left empty
  defaultValue?: string;
  inputDir?: "ltr" | "rtl";
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
};

// Promise-based replacement for window.prompt / window.confirm:
//   const [ask, askDialog] = useAsk();  …  const v = await ask({...}); // null = cancelled
export function useAsk(): [(o: AskOptions) => Promise<string | null>, React.ReactNode] {
  const [opts, setOpts] = useState<AskOptions | null>(null);
  const [value, setValue] = useState("");
  const resolver = useRef<((v: string | null) => void) | null>(null);

  const ask = useCallback((o: AskOptions) => new Promise<string | null>((resolve) => {
    resolver.current = resolve;
    setValue(o.defaultValue ?? "");
    setOpts(o);
  }), []);

  const finish = (v: string | null) => { resolver.current?.(v); resolver.current = null; setOpts(null); };

  const node = (
    <Dialog open={!!opts} title={opts?.title ?? ""} onClose={() => finish(null)}>
      {opts?.message && <p className="text-sm text-stone-700 whitespace-pre-line">{opts.message}</p>}
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); finish(opts?.input ? value : "yes"); }}>
        {opts?.input && (
          <input value={value} onChange={(e) => setValue(e.target.value)} autoFocus dir={opts.inputDir}
            className="rounded-lg border border-stone-300 px-3 py-2.5 text-sm focus:outline-2 focus:outline-stone-900" />
        )}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={() => finish(null)} className="rounded-lg border border-stone-300 px-4 py-2 text-sm">{opts?.cancelLabel}</button>
          <button type="submit" disabled={!!opts?.input && !opts.optional && !value.trim()}
            className={`rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-40 ${opts?.danger ? "bg-red-800 text-white" : "bg-[var(--accent)] text-[var(--on-accent)]"}`}>
            {opts?.confirmLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
  return [ask, node];
}
