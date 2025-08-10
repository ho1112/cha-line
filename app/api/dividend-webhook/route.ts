// /app/api/dividend-webhook/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { sendLineMessage } from '@/lib/notification';

export const runtime = 'nodejs';
export const maxDuration = 60; // seconds

export async function POST(request: NextRequest) {
  try {
    console.log('Dividend webhook received');
    
    // Render 스크래핑 서버에 작업 요청
    const renderResponse = await fetch(process.env.RENDER_SCRAPER_URL!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'scrape_dividend',
        timestamp: new Date().toISOString()
      })
    });

    if (!renderResponse.ok) {
      throw new Error(`Render API error: ${renderResponse.status}`);
    }

    const scrapeResult = await renderResponse.json();
    
    if (scrapeResult.success) {
      // 스크래핑 성공 시 LINE 메시지 전송
      await sendLineMessage(scrapeResult.data);
      console.log('Dividend information sent to LINE successfully');
      
      return NextResponse.json({ 
        success: true, 
        message: 'Dividend information processed and sent to LINE',
        data: scrapeResult.data
      });
    } else {
      // 스크래핑 실패 시 에러 메시지 전송
      const errorMessage = scrapeResult.error || 'Failed to scrape dividend information';
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
