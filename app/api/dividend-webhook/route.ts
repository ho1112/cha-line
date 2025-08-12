// /app/api/dividend-webhook/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { scrapeDividend } from '@/lib/scraper';
import { sendLineMessage } from '@/lib/notification';

export const runtime = 'nodejs';
export const maxDuration = 60; // seconds

export async function POST(request: NextRequest) {
  try {
    console.log('Dividend webhook received');
    
    // 요청 바디에서 날짜 정보 추출
    const body = await request.json();
    const { from, to } = body;
    
    console.log(`Scraping dividend for period: ${from} ~ ${to}`);
    
    // 직접 scraper.ts를 호출하여 스크래핑 실행
    const scrapeResult = await scrapeDividend({
      overrideDates: from && to ? { from, to } : undefined
    });
    
    if (scrapeResult) {
      // 스크래핑 성공 시 LINE 메시지 전송
      await sendLineMessage(scrapeResult);
      console.log('Dividend information sent to LINE successfully');
      
      return NextResponse.json({ 
        success: true, 
        message: 'Dividend information processed and sent to LINE',
        data: scrapeResult
      });
    } else {
      // 스크래핑 실패 시 에러 메시지 전송
      const errorMessage = 'Failed to scrape dividend information';
      await sendLineMessage({
        type: 'error',
        message: errorMessage
      });
      
      return NextResponse.json({ 
        success: false, 
        error: errorMessage 
      }, { status: 500 });
    }

  } catch (error) {
    console.error('Webhook processing failed:', error);
    
    // 에러 발생 시 LINE으로 에러 알림
    try {
      await sendLineMessage({
        type: 'error',
        message: `Webhook processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    } catch (lineError) {
      console.error('Failed to send error notification to LINE:', lineError);
    }
    
    return NextResponse.json({ 
      success: false, 
      error: 'Internal server error' 
    }, { status: 500 });
  }
}
