import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for standalone Docker deployment
  output: "standalone",
  // Externalize Playwright to prevent bundling issues
  serverExternalPackages: ["playwright-core"],
};

export default nextConfig;
