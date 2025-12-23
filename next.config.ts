import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Externalize Playwright to prevent bundling issues
  serverExternalPackages: ["playwright-core"],
};

export default nextConfig;
