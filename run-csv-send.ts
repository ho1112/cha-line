import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import * as fs from 'fs';
import * as iconv from 'iconv-lite';
import { sendLineMessage, sendFlexMessage } from './lib/notification';
import { parseDividendCsvText } from './lib/csv';
import { buildDividendFlex } from './lib/flex';

type CsvRecord = {
  '受渡日': string;
  '口座': string;
  '商品': string;
  '銘柄名': string;
  '数量': string;
  '受取額(税引後・円)': string;
};

function parseAmountYen(value: string): number {
  const cleaned = value.replace(/[,\s]/g, '');
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

(async () => {
  const csvPath = process.env.CSV_PATH || './sbi_0806.csv';
  console.log(`[run-csv-send] Using CSV: ${csvPath}`);

  // 1) 파일 읽기 및 Shift_JIS 디코딩
  const fileBuffer = fs.readFileSync(csvPath);
  const csvData = iconv.decode(fileBuffer, 'Shift_JIS');

  // 2) 공통 파서로 파싱(메타+상세 자동 인식)
  const parsed = parseDividendCsvText(csvData);
  const records = parsed.items as CsvRecord[];

  if (!records.length) {
    console.log('[run-csv-send] No records parsed from CSV.');
    process.exit(0);
  }

  // 3) 메시지 구성(기간 + 리스트 + 합계)
  const linesOut: string[] = [];
  if (parsed.period) {
    linesOut.push(`[期間] ${parsed.period}`);
  }
  let total = 0;
  for (const r of records) {
    const stock = r['銘柄名'];
    const date = r['受渡日'];
    const amountStr = r['受取額(税引後・円)'];
    const amount = parseAmountYen(amountStr);
    total += amount;
    linesOut.push(`- ${stock}: ${amount.toLocaleString('ja-JP')}円 (受渡日: ${date})`);
  }
  const totalYen = parsed.totalYen ?? total;
  linesOut.push(`\n合計: ${totalYen.toLocaleString('ja-JP')}円`);
  if (parsed.totalUsd != null) {
    linesOut.push(`(USD換算: ${parsed.totalUsd.toLocaleString('en-US')}$)`);
  }

  const text = linesOut.join('\n');

  // 5) LINE 전송: 기본 Flex로 통일
  const flex = buildDividendFlex(parsed);
  await sendFlexMessage(flex, '배당 알림');
  console.log('[run-csv-send] FLEX message sent.');
})();


