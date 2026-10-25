import type { MetadataRoute } from "next";

// Makes the app installable ("Add to Home Screen" on iOS/iPadOS, "Install
// app" on Android/Chrome) so it opens full-screen like a native scanner app.
// No service worker: every page needs the server, so there's no offline mode.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Bin Vault",
    short_name: "Bin Vault",
    description: "Self-hosted inventory and BOM management for components",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#eeeeee",
    theme_color: "#00b800",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
