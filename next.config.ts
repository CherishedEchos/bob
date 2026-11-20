import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Microphone allowed for this origin only (voice assistant); everything else off.
  { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  // pdfkit reads its font metric files from node_modules at runtime.
  serverExternalPackages: ["pdfkit"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // The app itself must never be framed (clickjacking)…
      { source: "/((?!f/|api/files/|api/handover-reports/).*)", headers: [{ key: "X-Frame-Options", value: "DENY" }, { key: "Content-Security-Policy", value: "frame-ancestors 'none'" }] },
      // Private job files can be previewed (PDF viewer) inside Bob's own pages only.
      { source: "/api/handover-reports/:path*", headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }, { key: "Content-Security-Policy", value: "frame-ancestors 'self'" }] },
      { source: "/api/files/:path*", headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }, { key: "Content-Security-Policy", value: "frame-ancestors 'self'" }] },
      // …except the public enquiry form, which businesses embed on their own websites.
      { source: "/f/:path*", headers: [{ key: "Content-Security-Policy", value: "frame-ancestors *" }] },
    ];
  },
};

export default nextConfig;
