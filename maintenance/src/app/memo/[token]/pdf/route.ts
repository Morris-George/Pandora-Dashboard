import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 30;

// The customer's receipt as a real PDF file (linked from the WhatsApp "received" message).
// Renders the same memo page (/memo/<token>) in headless Chrome and prints it to an 80 mm PDF.
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  try { return await render(req, ctx); }
  catch (e) { console.error("memo pdf", e); return new NextResponse(`PDF failed: ${(e as Error).message?.slice(0, 200)}`, { status: 500 }); }
}

async function render(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f]{32}$/.test(token)) return new NextResponse("Not found", { status: 404 });
  const { data: tk } = await createAdminClient().from("tickets").select("ticket_no").eq("tracking_token", token).neq("status", "draft").maybeSingle();
  if (!tk) return new NextResponse("Not found", { status: 404 });

  const puppeteer = (await import("puppeteer-core")).default;
  const local = process.env.CHROME_PATH; // local dev: path to an installed Chrome
  const chromium = local ? null : (await import("@sparticuz/chromium")).default;
  const browser = await puppeteer.launch(chromium
    ? { args: chromium.args, executablePath: await chromium.executablePath(), headless: true }
    : { executablePath: local!, headless: true });
  try {
    const page = await browser.newPage();
    const origin = new URL(req.url).origin;
    await page.goto(`${origin}/maintenance/memo/${token}`, { waitUntil: "networkidle0", timeout: 20000 });
    // The serverless Chrome ships without Arabic fonts: use a web font
    await page.addStyleTag({ url: "https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;700;800&display=block" }).catch(() => {});
    await page.addStyleTag({ content: ".receipt, .receipt * { font-family: 'Noto Sans Arabic', system-ui, sans-serif !important; }" });
    await page.evaluate(() => document.fonts.ready);
    await page.emulateMediaType("print");
    const h = await page.evaluate(() => document.documentElement.scrollHeight); // one receipt-length page, no blank tail
    const pdf = await page.pdf({ width: "80mm", height: `${Math.ceil(h * 0.2646) + 8}mm`, printBackground: true, preferCSSPageSize: false, margin: { top: "3mm", bottom: "3mm", left: "3mm", right: "3mm" } });
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="Pandora-${tk.ticket_no}.pdf"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } finally {
    await browser.close();
  }
}
