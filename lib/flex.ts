import type { DividendCsvParsed, DividendItem } from './csv';

// [편집 포인트] 버블당 아이템 수를 조절하려면 buildDividendFlex 아래의 호출부 size 값을 바꾸세요.
function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function buildItemBlocks(items: DividendItem[]) {
  const blocks: any[] = [];
  for (const it of items) {
    const stock = it['銘柄名'];
    const amount = it['受取額(税引後・円)'];
    const qty = it['数量'];
    const date = it['受渡日'];
    const product = (it as any)['商品'] || '';
    const flag = product.includes('米国') ? '🇺🇸' : ((product.includes('国内') || product.includes('現物')) ? '🇯🇵' : '');
    const nameWithFlag = flag ? `${flag} ${stock}` : stock;
    const acctRaw = (it as any)['口座'] || '';
    const acctLabel = acctRaw
      .replace('NISA（成長投資枠）', 'NISA成長')
      .replace('NISA（つみたて投資枠）', 'NISAつみたて');

    // [편집 포인트] 종목명/금액 배치: flex 비율(왼쪽 4, 오른쪽 3), wrap 여부, 텍스트 정렬(align)
    blocks.push({
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: nameWithFlag, weight: 'bold', flex: 4, wrap: true },
        { type: 'text', text: `${amount}円`, align: 'end', flex: 3 }
      ]
    });
    // [편집 포인트] 보조 정보(수량/受渡日/口座) 스타일: size, color, wrap 변경
    const metaRight = acctLabel ? ` / ${acctLabel}` : '';
    blocks.push({ type: 'text', text: `数量: ${qty} / 受渡日: ${date}${metaRight}`, size: 'xs', color: '#888888', wrap: true });
  }
  return blocks;
}

function buildBubble(pageItems: DividendItem[], period?: string | null, totalYen?: number | null, totalUsd?: number | null, categoryTotals?: Array<{ label: string; yen?: number | null; usd?: number | null }>) {
  const iconUrl = 'https://cha-line.vercel.app/icon.png';
  // [편집 포인트] 헤더: 아이콘+제목 줄 정렬/여백(justifyContent, alignItems, spacing), 아이콘 size, 제목 margin/flex
  const headerContents: any[] = [
    {
      type: 'box',
      layout: 'horizontal',
      justifyContent: 'flex-start',
      alignItems: 'center',
      spacing: 'sm',
      contents: [
        { type: 'image', url: iconUrl, size: 'xxs', flex: 0 },
        { type: 'text', text: '配当金のお知らせ', weight: 'bold', size: 'lg', margin: 'sm', flex: 1, align: 'start', wrap: true }
      ]
    }
  ];
  if (period) {
    // [편집 포인트] 기간 텍스트 스타일(size, color)
    headerContents.push({ type: 'text', text: `${period}`, size: 'sm', color: '#888888' });
  }

  const bodyBlocks = buildItemBlocks(pageItems);

  const footerBlocks: any[] = [];
  // [편집 포인트] 합계 영역 구분선 표시/제거
  if (totalYen != null || totalUsd != null) footerBlocks.push({ type: 'separator' });
  // カテゴリ小計（ある場合のみ、合計の前に表示）
  if (categoryTotals && categoryTotals.length > 0) {
    for (const ct of categoryTotals) {
      const yenText = `${(ct.yen ?? 0).toLocaleString('ja-JP')}円`;
      const usdText = `${(ct.usd ?? 0).toLocaleString('en-US')}$`;
      const right = ct.usd != null ? `(${usdText}) ${yenText}` : yenText;
      footerBlocks.push({
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: ct.label, flex: 2 },
          { type: 'text', text: right, align: 'end', flex: 3 }
        ]
      });
    }
  }

  if (totalYen != null) {
    // [편집 포인트] 합계(円) 행: 폰트 굵기/정렬/레이아웃 조정
    footerBlocks.push({
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: '合計', weight: 'bold', flex: 2 },
        { type: 'text', text: `${totalYen.toLocaleString('ja-JP')}円`, align: 'end', flex: 3 }
      ]
    });
  }
  if (totalUsd != null) {
    // [편집 포인트] 합계(USD) 행: 표기/정렬/표시 여부
    footerBlocks.push({
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: 'USD換算', weight: 'bold', flex: 2 },
        { type: 'text', text: `${totalUsd.toLocaleString('en-US')}$`, align: 'end', flex: 3 }
      ]
    });
  }

  const bubble: any = {
    type: 'bubble',
    size: 'mega',
    header: { type: 'box', layout: 'vertical', paddingBottom: 'xs',contents: headerContents },
    // [편집 포인트] 본문 간격: spacing 조절, 필요 시 paddingAll 추가 가능
    body: { type: 'box', layout: 'vertical', spacing: 'xs', contents: bodyBlocks },
  };
  if (footerBlocks.length > 0) bubble.footer = { type: 'box', layout: 'vertical', spacing: 'sm', contents: footerBlocks };
  return bubble;
}

export function buildDividendFlex(parsed: DividendCsvParsed): any {
  const items = parsed.items || [];
  const pages = chunkArray(items, 10); // [편집 포인트] 버블당 아이템 수 (기본 10)
  const count = items.length;
  const totalYenText = parsed.totalYen != null ? `${parsed.totalYen.toLocaleString('ja-JP')}円` : '';
  const alt = count > 0 && totalYenText
    ? `🎉 配当金が入金されました。合計 ${totalYenText} / ${count}件`
    : '配当金のお知らせ';
  const bubbles = pages.map((p, idx) => buildBubble(
    p,
    parsed.period,
    idx === 0 ? parsed.totalYen ?? null : null,
    idx === 0 ? parsed.totalUsd ?? null : null,
    idx === 0 ? parsed.categoryTotals ?? [] : [],
  ));

  if (bubbles.length === 1) {
    return { type: 'flex', altText: alt, contents: bubbles[0] };
  }
  return { type: 'flex', altText: alt, contents: { type: 'carousel', contents: bubbles } };
}

export function buildTextFlex(text: string, title: string = '알림'): any {
  const lines = text.split(/\r?\n/).filter(Boolean).map((t) => ({ type: 'text', text: t, wrap: true }));
  return {
    type: 'flex',
    altText: title,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: title, weight: 'bold', size: 'lg' }] },
      body: { type: 'box', layout: 'vertical', spacing: 'md', contents: lines.length ? lines : [{ type: 'text', text: '(내용 없음)' }] },
    },
  };
}


