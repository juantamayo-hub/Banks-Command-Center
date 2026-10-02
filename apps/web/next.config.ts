import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['archiver', 'archiver-zip-encrypted'],
  // GIF del tutorial de Alma: se sirve con login desde /api/alma/tutorial (no es público)
  outputFileTracingIncludes: {
    '/api/alma/tutorial': ['./private/alma-tutorial.gif'],
  },
};

export default nextConfig;
