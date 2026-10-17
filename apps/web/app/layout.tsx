import type { Metadata } from "next";
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
      <head>
        <script
          async
          blocking="render"
          data-storage-key={THEME_STORAGE_KEY}
          id="theme-initializer"
          src="/theme-initializer.js"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
