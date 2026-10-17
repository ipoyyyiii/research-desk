import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { eq } from "drizzle-orm";
import "./globals.css";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { PreferencesProvider, type Locale, type Theme } from "@/lib/preferences";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "research-desk",
  description: "Satu tempat untuk nulis skripsi + baca jurnal + tanya AI.",
};

async function getPreferences(): Promise<{ locale: Locale; theme: Theme }> {
  try {
    const rows = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
    const row = rows[0];
    return {
      locale: (row?.locale as Locale | undefined) ?? "id",
      theme: (row?.theme as Theme | undefined) ?? "system",
    };
  } catch {
    return { locale: "id", theme: "system" };
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const preferences = await getPreferences();
  return (
    <html lang={preferences.locale} suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <PreferencesProvider initialLocale={preferences.locale} initialTheme={preferences.theme}>
          {children}
        </PreferencesProvider>
      </body>
    </html>
  );
}
