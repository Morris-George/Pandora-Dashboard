import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Noto_Sans_Arabic } from "next/font/google";
import { getI18n } from "@/lib/i18n";
import "./globals.css";

const inter = Plus_Jakarta_Sans({ variable: "--font-inter", subsets: ["latin"] });
const arabic = Noto_Sans_Arabic({ variable: "--font-arabic", subsets: ["arabic"] });

export const metadata: Metadata = {
  title: "Pandora Maintenance",
  description: "Maintenance & repair lifecycle platform",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { locale, dir } = await getI18n();
  return (
    <html lang={locale} dir={dir}>
      <body className={`${inter.variable} ${arabic.variable} antialiased`}>{children}</body>
    </html>
  );
}
