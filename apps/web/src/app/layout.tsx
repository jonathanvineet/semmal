import type { Metadata, Viewport } from "next";
import { Figtree, Martian_Mono, Sora } from "next/font/google";
import "../styles/kit/system.css";
import "../styles/kit/motion.css";
import "../styles/globals.css";
import { Footer, Nav } from "@/components/Chrome";

const sora = Sora({ subsets: ["latin"], variable: "--f-sora", display: "swap" });
const figtree = Figtree({ subsets: ["latin"], variable: "--f-figtree", display: "swap" });
const mono = Martian_Mono({ subsets: ["latin"], variable: "--f-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Semmal · Inspection robots that hire their own AI specialists",
  description: "Robot-as-a-service marketplace. Each robot hires specialist agents itself, uses 0G private inference and records incidents on Arkiv. Simulation build.",
  other: { "page-type": "software", "site-kind": "tech" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#18191b" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-type="software" data-radius="soft" data-tone="dark" className={`${sora.variable} ${figtree.variable} ${mono.variable}`}>
      <body>
        <div className="sim-banner" role="note">SIMULATION · robots run in Gazebo-style simulation · real and simulated data are labelled</div>
        <Nav />
        <main id="main">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
