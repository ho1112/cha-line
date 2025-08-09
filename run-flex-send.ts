import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import * as fs from 'fs';
import { sendFlexMessage } from './lib/notification';
import { parseDividendCsvText } from './lib/csv';
import { buildDividendFlex } from './lib/flex';
import * as iconv from 'iconv-lite';

(async () => {
  try {
    const flexJsonPath = process.env.FLEX_JSON_PATH || './flex.json';
    const csvPath = process.env.CSV_PATH || './sbi_0809.csv';

    // 1) CSV가 있으면 최신 로직으로 flex.json을 재생성
    if (fs.existsSync(csvPath)) {
      console.log(`[run-flex-send] CSV detected → regenerate flex.json from: ${csvPath}`);
      const buf = fs.readFileSync(csvPath);
      const csvText = iconv.decode(buf, 'Shift_JIS');
      const parsed = parseDividendCsvText(csvText);
      const flex = buildDividendFlex(parsed);
      const toWrite = JSON.stringify(flex.contents ?? flex, null, 2);
      fs.writeFileSync(flexJsonPath, toWrite, 'utf-8');
      console.log(`[run-flex-send] flex.json updated: ${flexJsonPath}`);
      await sendFlexMessage(flex, '配当金のお知らせ');
      console.log('[run-flex-send] FLEX message sent (from CSV).');
      return;
    }

    // 2) CSV 없으면 기존 flex.json을 그대로 보냄
    const raw = fs.readFileSync(flexJsonPath, 'utf-8');
    const json = JSON.parse(raw);
    await sendFlexMessage(json, '配当金のお知らせ');
    console.log('[run-flex-send] FLEX message sent (from flex.json).');
  } catch (e) {
    console.error('[run-flex-send] Failed:', e);
    process.exit(1);
  }
})();


