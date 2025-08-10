// /app/api/dividend-webhook/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { scrapeDividend } from '@/lib/scraper';
import { sendLineMessage, sendErrorMessage } from '@/lib/notification';

export const runtime = 'nodejs';
export const maxDuration = 60; // seconds

export async function POST(request: NextRequest) {
  // LINE의 웹훅인지, GAS의 트리거인지 판별
  const isLineWebhook = request.headers.get('x-line-signature');

  // TODO: x-line-signature 검증 로직 추가
  // GAS 보호: LINE 서명이 없는 요청은 x-gas-secret을 검증
  if (!isLineWebhook) {
    const gasSecret = request.headers.get('x-gas-secret');
    if (!process.env.GAS_SHARED_SECRET || gasSecret !== process.env.GAS_SHARED_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const body = await request.json().catch(() => ({}));
    const overrideDates = {
      from: typeof body?.from === 'string' ? body.from : undefined,
      to: typeof body?.to === 'string' ? body.to : undefined,
    };

    // Vercel 환경에서는 브라우저 자동화 대신 간단한 메시지 전송
    let dividendData;
    
    try {
      // 1. 먼저 브라우저 자동화 시도 (로컬 환경에서만 작동)
      dividendData = await scrapeDividend({ overrideDates });
    } catch (browserError: any) {
      console.log('Browser automation failed, using fallback message:', browserError.message);
      
      // 2. Vercel 환경에서 사용할 수 있는 fallback 메시지
      dividendData = {
        text: `Vercel 환경에서는 브라우저 자동화를 지원하지 않습니다. 로컬 환경에서 테스트해주세요.\n\n요청된 날짜: ${overrideDates.from || '기본값'} ~ ${overrideDates.to || '기본값'}`,
        source: 'Vercel Fallback'
      };
    }

    if (dividendData) {
      // 3. LINE으로 성공 메시지 전송
      await sendLineMessage(dividendData);
      return NextResponse.json({ message: "Scraping and notification successful" });
    } else {
      return NextResponse.json({ message: "No new dividend data found to process." });
    }

  } catch (error: any) {
    console.error(error);
    // 4. 에러 발생 시 LINE으로 실패 메시지 전송
    await sendErrorMessage(error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
