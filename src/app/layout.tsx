import type { Metadata, Viewport } from "next";
import "./globals.css";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "AetherVault | Non-Custodial DeFi Wallet",
  description: "Production-grade non-custodial multi-chain DeFi wallet PWA",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#07090E",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
