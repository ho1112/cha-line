import * as fs from 'fs';
import { parse } from 'csv-parse/sync';
import * as iconv from 'iconv-lite';

console.log('--- Starting CSV Parse Test ---');

// 1. 로컬 CSV 파일을 바이너리 버퍼로 읽어옵니다.
const filePath = './sbi_0806.csv'; 
const fileBuffer = fs.readFileSync(filePath);

// 2. 버퍼를 Shift_JIS 인코딩으로 디코딩합니다.
const csvData = iconv.decode(fileBuffer, 'Shift_JIS');
console.log('\n--- Decoded CSV Data (first 300 chars) ---\n', csvData.substring(0, 300), '\n');

// 3. CSV 데이터에서 불필요한 상단 헤더 정보(9줄)를 제거합니다.
const lines = csvData.split(/\r?\n/); // Windows와 Unix 개행 문자 모두 처리
const dataRows = lines.slice(9).join('\n');

// 4. 실제 데이터 부분을 파싱합니다.
const records = parse(dataRows, {
    // columns: true, // 실제 데이터의 첫 줄을 헤더로 사용
    columns: ['受渡日', '口座', '商品', '銘柄名', '数量', '受取額(税引後・円)'], // 실제 헤더 이름으로 지정
    skip_empty_lines: true,
});

console.log('--- Parsed Records ---');
console.log(records);
console.log('\n--- CSV Parse Test Finished ---');
