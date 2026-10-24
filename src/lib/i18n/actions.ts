"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getLocale, LOCALE_COOKIE } from "./index";

export async function toggleLocale() {
  const next = (await getLocale()) === "ar" ? "en" : "ar";
  (await cookies()).set(LOCALE_COOKIE, next, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidatePath("/", "layout");
}
