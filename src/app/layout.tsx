import "@fontsource-variable/archivo/standard.css";
import "@fontsource-variable/inter/index.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: { default: "DRAUM CONTROL", template: "%s · DRAUM CONTROL" },
  description: "DRAUM CONTROL — The Business Behind the Movement.",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { themeColor: "#252624" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
