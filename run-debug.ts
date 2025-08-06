import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { scrapeDividend } from './lib/scraper';

(async () => {
  console.log('Starting Playwright debug script...');
  try {
    // `scrapeDividend` 함수를 직접 호출합니다.
    const result = await scrapeDividend();
    console.log('\n--- Scraping Result ---');
    console.log(result);
    console.log('-----------------------\n');
  } catch (error) {
    console.error('\n--- An error occurred ---');
    console.error(error);
    console.log('--------------------------\n');
  } finally {
    console.log('Debug script finished.');
    // 스크립트가 즉시 종료되지 않도록, 필요하다면 여기서 process.exit()를 호출할 수 있습니다.
    // 하지만 보통은 모든 비동기 작업이 끝나면 자동으로 종료됩니다.
  }
})();