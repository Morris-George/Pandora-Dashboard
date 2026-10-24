"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useAsk } from "@/components/ask";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import type { AppRole } from "@/lib/auth";
import { changeEmail, createUser, renameUser, resetTwoStep, decideRoleChange, deleteUser, excludeFromSync, requestRoleChange, resetPassword, setActive, setBranches } from "./actions";

export type UserRow = {
  id: string; name: string; email: string; role: AppRole; active: boolean; source: string; mustChange: boolean; branchIds: string[];
  isNew: boolean;
};
export type PendingRow = { id: string; userName: string; newRole: AppRole; mine: boolean };
type Branch = { id: string; name: string };

const ROLES: AppRole[] = ["associate", "manager", "courier", "hq", "technician", "supervisor", "cs", "finance", "ops", "admin"];
const BRANCH_ROLES: AppRole[] = ["associate", "manager"];
const input = "rounded-lg border border-stone-300 px-3 py-2.5 text-sm font-normal focus:outline-2 focus:outline-stone-900";
const small = "rounded-lg border px-2.5 py-1.5 text-xs disabled:opacity-40";

export function UsersPanel({ locale, meId, users, pending, branches }: {
  locale: Locale; meId: string; users: UserRow[]; pending: PendingRow[]; branches: Branch[];
}) {
  const d = dictionaries[locale];
  const t = d.admin;
  const [busy, start] = useTransition();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const router = useRouter();
  const [ask, askDialog] = useAsk();
  const [store, setStore] = useState(""); // "" = all, "none" = no store (HQ / central roles), else branch id
  const [team, setTeam] = useState<"" | AppRole>(""); // "" = every role
  const shownUsers = users.filter((u) => (!store || (store === "none" ? !u.branchIds.length : u.branchIds.includes(store))) && (!team || u.role === team));
  const perStore = (id: string) => users.filter((u) => u.active && u.branchIds.includes(id)).length;
  const [temp, setTemp] = useState<{ email: string; password: string } | null>(null);
  const [roleDraft, setRoleDraft] = useState<Record<string, AppRole>>({});
  const [branchDraft, setBranchDraft] = useState<Record<string, string[]>>({});

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AppRole>("technician");
  const [newBranches, setNewBranches] = useState<string[]>([]);

  const run = (fn: () => Promise<{ error?: string; password?: string }>, emailForTemp?: string, after?: () => void) =>
    start(async () => {
      setError("");
      // A page left open across a deploy throws here: show a message instead of crashing
      const r = await fn().catch(() => ({ error: "stale" } as { error: string; password?: string }));
      if (r.error) { setError(t.errors[r.error] ?? t.errors.failed); return; }
      if (r.password && emailForTemp) setTemp({ email: emailForTemp, password: r.password });
      after?.();
    });

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <>
      {temp && (
        <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 flex flex-col gap-2">
          <strong>{t.tempTitle}</strong>
          <code className="text-lg font-mono bg-white rounded-lg border border-amber-200 px-3 py-2 select-all" dir="ltr">{temp.password}</code>
          <span className="text-sm">{t.tempFor(temp.email)}</span>
          <button onClick={() => setTemp(null)} className="self-start rounded-lg bg-[var(--accent)] text-[var(--on-accent)] px-4 py-2 text-sm">{t.dismiss}</button>
        </div>
      )}
      {error && <p role="alert" className="rounded-lg bg-red-50 text-red-800 text-sm p-3">{error}</p>}
      {askDialog}
      {notice && <p role="status" className="rounded-lg bg-emerald-50 text-emerald-900 text-sm p-3">{notice}</p>}

      <section className="bg-white rounded-2xl border border-stone-200 p-6 flex flex-col gap-4">
        <div>
          <h1 className="text-xl font-semibold">{t.usersTitle}</h1>
          <p className="text-sm text-stone-600 mt-1">{t.usersNote}</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="flex flex-wrap items-center gap-2 text-sm font-medium">{t.storeFilter}
          <select value={store} onChange={(e) => setStore(e.target.value)} className={`${input} py-2`}>
            <option value="">{t.allStores(users.length)}</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({perStore(b.id)})</option>)}
            <option value="none">{t.noStore(users.filter((u) => !u.branchIds.length).length)}</option>
          </select>
        </label>
        <label className="flex flex-wrap items-center gap-2 text-sm font-medium">{t.teamFilter}
          <select value={team} onChange={(e) => setTeam(e.target.value as "" | AppRole)} className={`${input} py-2`}>
            <option value="">{t.allTeams(users.length)}</option>
            {ROLES.map((r) => <option key={r} value={r}>{d.roles[r]} ({users.filter((u) => u.role === r).length})</option>)}
          </select>
          {(store || team) && <span className="text-stone-500 font-normal">{t.showing(shownUsers.length)}</span>}
        </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="text-xs text-stone-500">
                {Object.values(t.cols).map((c) => <th key={c} className="p-2 text-start font-medium">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {shownUsers.map((u) => {
                const self = u.id === meId;
                const draftRole = roleDraft[u.id] ?? u.role;
                const draftBranches = branchDraft[u.id] ?? u.branchIds;
                return (
                  <tr key={u.id} className={`border-t border-stone-100 align-top ${u.active && BRANCH_ROLES.includes(u.role) && !u.branchIds.length ? "bg-red-50/60" : u.isNew ? "bg-[var(--fill-soft)]/50" : ""}`}>
                    <td className="p-2">
                      <div className="font-semibold">{u.name}{self && <span className="text-xs text-stone-500"> ({t.you})</span>}</div>
                      <div className="text-xs text-stone-500" dir="ltr">{u.email}</div>
                      {u.mustChange && <div className="text-xs text-amber-800">{t.mustChange}</div>}
                      <div className="flex gap-1.5 mt-1">
                        {u.isNew && <span className="rounded-full bg-[var(--accent)] text-[var(--on-accent)] px-2 py-0.5 text-[11px] font-bold">{t.staff.new}</span>}
                        {u.active && BRANCH_ROLES.includes(u.role) && !u.branchIds.length && <span className="rounded-full bg-red-100 text-red-800 px-2 py-0.5 text-[11px] font-bold">{t.staff.notAllocated}</span>}
                      </div>
                    </td>
                    <td className="p-2">
                      <select value={draftRole} disabled={self || busy} aria-label={t.role}
                        onChange={(e) => setRoleDraft({ ...roleDraft, [u.id]: e.target.value as AppRole })} className={`${input} py-1.5`}>
                        {ROLES.map((r) => <option key={r} value={r}>{d.roles[r]}</option>)}
                      </select>
                      {draftRole !== u.role && (
                        <button disabled={busy} className={`${small} border-stone-900 mt-1 block`}
                          onClick={() => run(() => requestRoleChange(u.id, draftRole), undefined, () => {
                            const n = { ...roleDraft }; delete n[u.id]; setRoleDraft(n);
                            setNotice(draftRole === "admin" || u.role === "admin" ? t.roleRequested(u.name) : t.roleSaved(u.name, d.roles[draftRole]));
                            router.refresh();
                          })}>
                          {t.changeRole}
                        </button>
                      )}
                    </td>
                    <td className="p-2">
                      {BRANCH_ROLES.includes(u.role) ? (
                        <div className="flex flex-col gap-1">
                          {/* Compact picker: shows the chosen stores, opens to tick more */}
                          <details className="relative">
                            <summary className={`cursor-pointer list-none rounded-lg border px-2.5 py-1.5 text-xs max-w-52 truncate ${draftBranches.length ? "border-stone-300" : "border-red-400 text-red-800 font-semibold"}`}>
                              {draftBranches.length ? branches.filter((b) => draftBranches.includes(b.id)).map((b) => b.name).join(", ") : t.staff.notAllocated} ▾
                            </summary>
                            <div className="absolute z-10 mt-1 w-56 max-h-64 overflow-auto rounded-lg border border-stone-200 bg-white p-2 shadow-lg flex flex-col gap-1">
                              {branches.map((b) => (
                                <label key={b.id} className="flex items-center gap-1.5 text-xs">
                                  <input type="checkbox" checked={draftBranches.includes(b.id)} disabled={busy}
                                    onChange={() => setBranchDraft({ ...branchDraft, [u.id]: toggle(draftBranches, b.id) })} />
                                  {b.name}
                                </label>
                              ))}
                            </div>
                          </details>
                          {branchDraft[u.id] && (
                            <button disabled={busy || !draftBranches.length} className={`${small} border-stone-900 self-start`}
                              onClick={() => run(() => setBranches(u.id, draftBranches), undefined, () => { const n = { ...branchDraft }; delete n[u.id]; setBranchDraft(n); })}>
                              {t.saveBranches}
                            </button>
                          )}
                        </div>
                      ) : <span className="text-xs text-stone-500">{d.shell.allBranches}</span>}
                    </td>
                    <td className="p-2 text-xs">{t.source[u.source] ?? u.source}</td>
                    <td className={`p-2 text-xs font-semibold ${u.active ? "text-emerald-800" : "text-red-800"}`}>{u.active ? t.active : t.inactive}</td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-1.5">
                        <button disabled={busy} className={`${small} border-stone-900`} onClick={() => run(() => resetPassword(u.id), u.email)}>{t.reset}</button>
                        <button disabled={busy} className={`${small} border-stone-400`} onClick={async () => {
                          const next = await ask({ title: t.changeEmail, message: u.source === "erpnext" ? t.askEmailErp(u.email) : t.askEmail(u.email),
                            input: true, defaultValue: u.email, inputDir: "ltr", confirmLabel: t.dlg.save, cancelLabel: t.dlg.cancel });
                          if (next && next.trim().toLowerCase() !== u.email.toLowerCase()) run(() => changeEmail(u.id, next));
                        }}>{t.changeEmail}</button>
                        <button disabled={busy} className={`${small} border-stone-400`} onClick={async () => {
                          const next = await ask({ title: t.changeName, message: t.askName(u.email), input: true, defaultValue: u.name,
                            confirmLabel: t.dlg.save, cancelLabel: t.dlg.cancel });
                          if (next && next.trim() !== u.name) run(() => renameUser(u.id, next));
                        }}>{t.changeName}</button>
                        {u.role === "admin" && !self && (
                          <button disabled={busy} className={`${small} border-stone-400`}
                            onClick={async () => { if (await ask({ title: t.resetTwoStep, message: t.askResetTwoStep(u.name), confirmLabel: t.dlg.confirm, cancelLabel: t.dlg.cancel })) run(() => resetTwoStep(u.id)); }}>{t.resetTwoStep}</button>
                        )}
                        {!self && (
                          <button disabled={busy} className={`${small} border-red-800 text-red-800`} onClick={() => run(() => setActive(u.id, !u.active))}>
                            {u.active ? t.deactivate : t.reactivate}
                          </button>
                        )}
                        {!self && u.source === "erpnext" && (
                          <button disabled={busy} className={`${small} border-amber-700 text-amber-800`} title={t.erp.excludeHint}
                            onClick={async () => { const why = await ask({ title: t.erp.exclude, message: t.erp.excludeAsk, input: true, optional: true, confirmLabel: t.dlg.confirm, cancelLabel: t.dlg.cancel }); if (why !== null) run(() => excludeFromSync(u.id, why)); }}>
                            {t.erp.exclude}
                          </button>
                        )}
                        {!self && (
                          <button disabled={busy} className={`${small} border-red-800 bg-red-50 text-red-800`}
                            onClick={async () => { if (await ask({ title: t.erp.delete, message: t.erp.deleteAsk(u.email), danger: true, confirmLabel: t.erp.delete, cancelLabel: t.dlg.cancel })) run(() => deleteUser(u.id), undefined, () => {}); }}>
                            {t.erp.delete}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-stone-200 p-6 flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t.pendingTitle}</h2>
        {!pending.length && <p className="text-sm text-stone-600">{t.pendingNone}</p>}
        {pending.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-3 border-t border-stone-100 pt-3 text-sm">
            <span className="flex-1">{t.pendingRow(p.userName, d.roles[p.newRole])}</span>
            {p.mine ? <span className="text-xs text-stone-500">{t.ownRequest}</span> : (
              <>
                <button disabled={busy} className={`${small} border-stone-900`} onClick={() => run(() => decideRoleChange(p.id, true))}>{t.approve}</button>
                <button disabled={busy} className={`${small} border-red-800 text-red-800`} onClick={() => run(() => decideRoleChange(p.id, false))}>{t.reject}</button>
              </>
            )}
          </div>
        ))}
      </section>

      <section className="bg-white rounded-2xl border border-stone-200 p-6 flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold">{t.addTitle}</h2>
          <p className="text-sm text-stone-600 mt-1">{t.addNote}</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <label className="flex flex-col gap-1.5 text-sm font-medium">{t.name}
            <input value={name} onChange={(e) => setName(e.target.value)} className={input} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">{t.email}
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" dir="ltr" className={input} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">{t.role}
            <select value={role} onChange={(e) => setRole(e.target.value as AppRole)} className={input}>
              {ROLES.map((r) => <option key={r} value={r}>{d.roles[r]}</option>)}
            </select>
          </label>
        </div>
        {BRANCH_ROLES.includes(role) && (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium mb-1">{t.branches}</legend>
            <div className="flex flex-wrap gap-3">
              {branches.map((b) => (
                <label key={b.id} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={newBranches.includes(b.id)} onChange={() => setNewBranches(toggle(newBranches, b.id))} />
                  {b.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <button
          disabled={busy || name.trim().length < 2 || !email.includes("@") || (BRANCH_ROLES.includes(role) && !newBranches.length)}
          onClick={() => run(() => createUser({ fullName: name, email, role, branchIds: BRANCH_ROLES.includes(role) ? newBranches : [] }),
            email.trim().toLowerCase(), () => { setName(""); setEmail(""); setNewBranches([]); })}
          className="self-start rounded-lg bg-[var(--accent)] text-[var(--on-accent)] px-5 py-3 font-semibold disabled:opacity-40">
          {t.create}
        </button>
      </section>
    </>
  );
}
