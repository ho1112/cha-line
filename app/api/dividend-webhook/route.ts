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
    // 1. 스크래핑 실행
    const dividendData = await scrapeDividend();

    if (dividendData) {
      // 2. LINE으로 성공 메시지 전송
      await sendLineMessage(dividendData);
      return NextResponse.json({ message: "Scraping and notification successful" });
    } else {
      return NextResponse.json({ message: "No new dividend data found to process." });
    }

  } catch (error: any) {
    console.error(error);
    // 3. 에러 발생 시 LINE으로 실패 메시지 전송
    await sendErrorMessage(error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
