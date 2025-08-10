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
    // .map 파일들을 무시
    config.module.rules.push({
      test: /\.map$/,
      type: 'ignore'
    });

    // chrome-aws-lambda의 특정 문제가 있는 파일들을 무시
    config.module.rules.push({
      test: /chrome-aws-lambda.*\.js\.map$/,
      type: 'ignore'
    });

    return config;
  }
};

export default nextConfig;
