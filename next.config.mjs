/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['@sparticuz/chromium-min'],
    outputFileTracingIncludes: {
      'app/api/dividend-webhook/route.ts': ['./node_modules/@sparticuz/chromium-min/bin/**'],
      'app/api/test-scrape/route.ts': ['./node_modules/@sparticuz/chromium-min/bin/**']
    }
  }
};

export default nextConfig;
