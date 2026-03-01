import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@nextpannel/shared'],
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.API_URL ?? 'http://localhost:3500'}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
