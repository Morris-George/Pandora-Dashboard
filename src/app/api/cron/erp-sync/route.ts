import { NextResponse } from "next/server";
import { runErpSync, syncFaultCosts } from "@/lib/erp-sync";
import { flushEmails } from "@/lib/email";

export const maxDuration = 60;

// Daily ERPNext sync, called by Vercel Cron with "Authorization: Bearer <CRON_SECRET>"
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const summary = await runErpSync("cron");
  const costs = await syncFaultCosts().catch(() => -1); // fault category prices from ERPNext
  const emails = await flushEmails(100); // catch-up for anything not sent at the time
  return NextResponse.json({ ok: summary.errors.length === 0, summary, costs, emails });
}
