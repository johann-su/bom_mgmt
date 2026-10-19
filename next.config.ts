import type { NextConfig } from "next";

// Next's dev server compiles with eval(); production bundles don't need it.
const dev = process.env.NODE_ENV !== "production";

// Everything the app loads is same-origin: Tailwind ships a static
// stylesheet, next/font self-hosts, and uploaded images come from
// /api/files. 'unsafe-inline' stays because Next inlines its bootstrap
// scripts and React inlines style attributes.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  // Datasheet PDFs open in the browser's viewer from /api/files.
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  // OAuth sign-in posts to our own /api/auth, which redirects to the IdP.
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
