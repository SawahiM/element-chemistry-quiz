import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  output: "standalone",
  outputFileTracingRoot: process.cwd(),
  serverExternalPackages: ["postgres"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
