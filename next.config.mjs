/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['@sparticuz/chromium'],
    outputFileTracingIncludes: {
      'app/api/dividend-webhook/route.ts': ['./node_modules/@sparticuz/chromium/bin/**'],
      'app/api/test-scrape/route.ts': ['./node_modules/@sparticuz/chromium/bin/**']
    }
  }
};

export default nextConfig;
