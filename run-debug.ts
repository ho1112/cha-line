import dotenv from 'dotenv';
dotenv.config();

import { scrapeDividend } from './lib/scraper';
import { sendLineMessage } from './lib/notification';

(async () => {
  console.log('Starting Playwright debug script...');
  
  // Inspector 모드 설정
  if (process.env.PWDEBUG === '1') {
    console.log('Inspector 모드가 활성화되었습니다. Inspector 창에서 시작 버튼을 클릭하면 실행됩니다...');
  }
  
  try {
    // AUTH_ONLY=0 이면 전체 플로우 실행, 그 외에는 인증까지만
    const debugAuthOnly = process.env.AUTH_ONLY !== '0';
    const result = await scrapeDividend({ debugAuthOnly });
    console.log('\n--- Scraping Result ---');
    console.log(result);
    console.log('-----------------------\n');

    if (process.env.SEND_LINE === '1' && result && result.text) {
      console.log('Sending parsed CSV result to LINE...');
      await sendLineMessage(result);
      console.log('LINE message sent.');
    }
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