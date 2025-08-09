import { parse } from 'csv-parse/sync';

export type DividendItem = {
  '受渡日': string;
  '口座': string;
  '商品': string;
  '銘柄名': string;
  '数量': string;
  '受取額(税引後・円)': string;
};

export type DividendCsvParsed = {
  period?: string | null;
  totalYen?: number | null;
  totalUsd?: number | null;
  categoryTotals?: Array<{ label: string; yen?: number | null; usd?: number | null }>;
  items: DividendItem[];
};

function parseAmount(value?: string): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[\s,]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function parseDividendCsvText(csvText: string): DividendCsvParsed {
  // 1) 전체를 행 배열로 파싱 (열 수 유연)
  const rows: string[][] = parse(csvText, {
    skip_empty_lines: false,
    relax_column_count: true,
  });

  let period: string | null = null;
  let totalYen: number | null = null;
  let totalUsd: number | null = null;
  const categoryTotals: Array<{ label: string; yen?: number | null; usd?: number | null }> = [];

  // 2) 상단 메타 정보 스캔
  for (const row of rows) {
    if (!row || row.length === 0) continue;
    const c0 = (row[0] || '').toString();
    const c1 = (row[1] || '').toString();
    const c2 = (row[2] || '').toString();

    // 기간: 2025/8/4-2025/8/9 형태 탐지
    if (!period && /\d{4}\/\d{1,2}\/\d{1,2}-\d{4}\/\d{1,2}\/\d{1,2}/.test(c1)) {
      period = c1.trim();
    }

    // 합계(엔/달러)
    if ((c0.includes('合計') || c0.includes('小計')) && (c1 || c2)) {
      if (totalYen == null) totalYen = parseAmount(c1);
      if (totalUsd == null) totalUsd = parseAmount(c2);
    }

    // カテゴリ小計（例: 国内株式(現物), 米国株式 など）
    // 上段メタ部に現れる場合のみ収集
    if (
      (c0.includes('国内株式') || c0.includes('米国株式') || c0.includes('現物')) &&
      (c1 || c2)
    ) {
      const yen = parseAmount(c1);
      const usd = parseAmount(c2);
      categoryTotals.push({ label: c0.trim(), yen, usd });
    }
  }

  // 3) 상세 헤더 라인 인덱스 찾기
  const expectedHeaders = ['受渡日', '口座', '商品', '銘柄名', '数量', '受取額(税引後・円)'];
  let headerIndex = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || [];
    const joined = r.join(',');
    if (expectedHeaders.every((h) => joined.includes(h))) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    return { period, totalYen, totalUsd, categoryTotals, items: [] };
  }

  // 4) 헤더 이후 구간을 유연하게 객체로 변환(숫자에 , 가 있어 열이 늘어난 경우 보정)
  const headerRow = rows[headerIndex];
  const startIdx = headerIndex + 1;
  const items: DividendItem[] = [];
  for (let i = startIdx; i < rows.length; i++) {
    const r = rows[i] || [];
    if (r.length === 0) continue;
    const first = (r[0] || '').toString().trim();
    if (!first) continue;
    // 최소 열 수 미달 시 스킵
    if (r.length < expectedHeaders.length - 1) continue;
    const obj: any = {};
    // 앞의 5개 컬럼은 그대로 매핑
    obj['受渡日'] = (r[0] || '').toString().replace(/^"|"$/g, '');
    obj['口座'] = (r[1] || '').toString().replace(/^"|"$/g, '');
    obj['商品'] = (r[2] || '').toString().replace(/^"|"$/g, '');
    obj['銘柄名'] = (r[3] || '').toString().replace(/^"|"$/g, '');
    obj['数量'] = (r[4] || '').toString().replace(/^"|"$/g, '');
    // 마지막 컬럼은 남은 필드를 다시 합쳐 원래 값 복원(예: 5,220.24)
    const tail = r.slice(5).map((c) => (c ?? '').toString().replace(/^"|"$/g, ''));
    obj['受取額(税引後・円)'] = tail.join(',');
    items.push(obj as DividendItem);
  }

  // 5) 방어적 필터: 헤더/공백 행 제거
  const cleaned = items.filter((it) => it['銘柄名'] && it['銘柄名'] !== '銘柄名' && it['受渡日'] && it['受渡日'] !== '受渡日');

  return {
    period,
    totalYen,
    totalUsd,
    categoryTotals,
    items: cleaned,
  };
}


