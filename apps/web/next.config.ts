import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['archiver', 'archiver-zip-encrypted'],
};

export default nextConfig;
