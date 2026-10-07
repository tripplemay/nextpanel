import type { NextConfig } from 'next';
import withBundleAnalyzer from '@next/bundle-analyzer';

const bundleAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

const nextConfig: NextConfig = {
  transpilePackages: ['@nextpannel/shared'],
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.API_URL ?? (process.env.NODE_ENV === 'production' ? 'http://127.0.0.1:3201' : 'http://127.0.0.1:3001')}/api/:path*`,
      },
    ];
  },
};

export default bundleAnalyzer(nextConfig);
