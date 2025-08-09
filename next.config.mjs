/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['@sparticuz/chromium'],
    outputFileTracingIncludes: {
      'app/api/dividend-webhook/route.ts': [
        './node_modules/@sparticuz/chromium/bin/**',
        './node_modules/@sparticuz/chromium/lib/**'
      ],
      'app/api/test-scrape/route.ts': [
        './node_modules/@sparticuz/chromium/bin/**',
        './node_modules/@sparticuz/chromium/lib/**'
      ]
    }
  }
};

export default nextConfig;
