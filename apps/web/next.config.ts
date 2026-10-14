import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  transpilePackages: ["@tokenrank/shared"],
  serverExternalPackages: ["pg", "@electric-sql/pglite", "embedded-postgres", "nodemailer"],
  poweredByHeader: false,
  // Logging hygiene: never echo server-function arguments, browser console
  // output or one-time links into the terminal.
  logging: {
    serverFunctions: false,
    browserToTerminal: false,
    incomingRequests: { ignore: [/\/recover\//, /\/api\/auth\//, /\/api\/v1\/device\//] },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
