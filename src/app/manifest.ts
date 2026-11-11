import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ninety3 Assistant",
    short_name: "Ninety3",
    description: "Jobs, enquiries and payments for Ninety3.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0c0b0a",
    theme_color: "#0c0b0a",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
