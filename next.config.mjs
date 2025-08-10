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
  }
};

export default nextConfig;
