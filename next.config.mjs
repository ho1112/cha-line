/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['@sparticuz/chromium'],
    outputFileTracingIncludes: {
      'app/api/dividend-webhook/route.ts': [
        './node_modules/@sparticuz/chromium/**'
      ],
      'app/api/test-scrape/route.ts': [
        './node_modules/@sparticuz/chromium/**'
      ]
    }
  }
};

export default nextConfig;
