import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import * as fs from 'fs';
import * as path from 'path';
import * as iconv from 'iconv-lite';
import { parseDividendCsvText } from './lib/csv';
import { buildDividendFlex } from './lib/flex';

(async () => {
  try {
    const [, , csvArg, outArg] = process.argv;
    const csvPath = csvArg || './sbi_0809.csv';
    const outPath = outArg || './flex.json';

    if (!fs.existsSync(csvPath)) {
      throw new Error(`CSV not found: ${csvPath}`);
    }

    const fileBuffer = fs.readFileSync(csvPath);
    const csvText = iconv.decode(fileBuffer, 'Shift_JIS');

    const parsed = parseDividendCsvText(csvText);
    const flex = buildDividendFlex(parsed);

    fs.writeFileSync(outPath, JSON.stringify(flex.contents ?? flex, null, 2), 'utf-8');
    console.log(`[generate] Wrote Flex JSON to: ${path.resolve(outPath)}`);
  } catch (e) {
    console.error('[generate] Failed:', e);
    process.exit(1);
  }
})();


