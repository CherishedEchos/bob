import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ninety3 Assistant",
  description: "Your jobs, enquiries and payments — with an assistant that helps you stay on top of them.",
  applicationName: "Ninety3 Assistant",
  appleWebApp: { capable: true, title: "Ninety3", statusBarStyle: "black-translucent" },
  icons: { icon: "/brand/ninety3-logo.png", apple: "/brand/ninety3-logo.png" },
  // Private business tool: keep it out of search engines.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0c0b0a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GB" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
