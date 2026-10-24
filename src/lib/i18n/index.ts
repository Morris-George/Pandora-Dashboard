import { cookies } from "next/headers";
import { dictionaries, type Locale } from "./dictionaries";

export const DEFAULT_LOCALE: Locale = "ar";
export const LOCALE_COOKIE = "lang";

export async function getLocale(): Promise<Locale> {
  const v = (await cookies()).get(LOCALE_COOKIE)?.value;
  return v === "en" || v === "ar" ? v : DEFAULT_LOCALE;
}

export async function getI18n() {
  const locale = await getLocale();
  return { locale, t: dictionaries[locale], dir: locale === "ar" ? "rtl" : "ltr" } as const;
}
