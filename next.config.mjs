/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['playwright'],
  outputFileTracingIncludes: {
    'app/api/dividend-webhook/route.ts': [
      './node_modules/playwright/**'
    ],
    'api/test-scrape/route.ts': [
      './node_modules/playwright/**'
    ]
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Vercel에서 puppeteer가 Chrome을 찾을 수 있도록 설정
      config.externals = config.externals || [];
      config.externals.push('puppeteer');
    }
    return config;
  }
};

export default nextConfig;
