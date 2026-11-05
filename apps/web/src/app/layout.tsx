import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Manrope } from "next/font/google";
import "../styles/kit/system.css";
import "../styles/kit/motion.css";
import "../styles/globals.css";
import { Footer } from "@/components/Chrome";
import { Dock } from "@/components/Dock";

const manrope = Manrope({ subsets: ["latin"], variable: "--f-text", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--f-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Semmal · A private network where robots hire AI agents",
  description: "Robot-as-a-service marketplace. Each robot hires specialist agents itself, uses 0G private inference and records incidents on Arkiv.",
  other: { "page-type": "software", "site-kind": "tech" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#18191b" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-type="software" data-radius="round" data-buttons="pill" data-tone="dark" className={`${manrope.variable} ${mono.variable}`}>
      <body>
        <Dock />
        <main id="main">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
