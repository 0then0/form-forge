import type { Metadata } from "next";
import Script from "next/script";
import type { ReactNode } from "react";

import { THEME_STORAGE_KEY } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "Form Forge",
  title: {
    default: "Form Forge",
    template: "%s · Form Forge",
  },
  description: "Headless forms with versioned schemas and reliable delivery.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Script id="theme-initializer" strategy="beforeInteractive">
          {`try{const key=${JSON.stringify(THEME_STORAGE_KEY)};const value=localStorage.getItem(key);const theme=value==="light"||value==="dark"||value==="system"?value:"system";const dark=theme==="dark"||(theme==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",dark);document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=dark?"dark":"light"}catch{const dark=matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.toggle("dark",dark);document.documentElement.style.colorScheme=dark?"dark":"light"}`}
        </Script>
        {children}
      </body>
    </html>
  );
}
