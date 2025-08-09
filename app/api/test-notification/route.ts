// /app/api/test-notification/route.ts
// 목적: SBI 증권 스크래핑 과정을 생략하고, Gmail 감지(GAS 호출) -> LINE 메시지 전송 기능만 테스트합니다.
// 사용법: LINE webhook URL을 이 API 주소로 설정하고, Google Apps Script의 fetchUrl에 이 API의 주소를 입력하여 호출합니다.

import { NextRequest, NextResponse } from 'next/server';
import { sendLineMessage, sendErrorMessage } from '@/lib/notification';
export const runtime = 'nodejs';
export const maxDuration = 30;
import { WebhookRequestBody } from '@line/bot-sdk';

export async function POST(request: NextRequest) {
  try {
    const body: WebhookRequestBody = await request.json();

    // LINE Developers Console의 'Verify' 요청인지 확인
    // 'Verify' 요청은 events 배열이 비어있는 상태로 전송됩니다.
    if (body.events && body.events.length === 0) {
      console.log('Received LINE webhook verification for /api/test-notification.');
      return NextResponse.json({ status: 'success' });
    }

    // 'Verify'가 아닌 실제 테스트 요청(GAS 호출 등)일 경우
    console.log('Executing Gmail->LINE notification test (scraping skipped)...');
    
    // 1. 스크래핑을 대체할 정적 테스트 데이터 생성
    const testDividendData = {
      text: '[테스트] Gmail 감지 및 LINE 연동이 정상입니다.\n(실제 스크래핑은 실행되지 않았습니다.)',
      source: '/api/test-notification',
    };

    // 2. 테스트 데이터를 사용하여 성공 메시지 전송
    await sendLineMessage(testDividendData);
    console.log('Test notification sent successfully.');

    // 3. 호출자(GAS)에게 성공 응답 반환
    return NextResponse.json({
      status: 'success',
      message: 'Test notification has been sent to LINE successfully.',
    });

  } catch (error: any) {
    console.error('Test notification failed:', error);

    // 4. 에러 발생 시 LINE으로 실패 메시지 전송
    try {
      await sendErrorMessage(`'/api/test-notification' 실행 중 에러 발생: ${error.message}`);
    } catch (sendError) {
      console.error('Failed to send the error message itself via LINE:', sendError);
    }

    // 5. 호출자(GAS)에게 에러 응답 반환
    return NextResponse.json({
      status: 'error',
      message: 'Failed to send test notification.',
      error: error.message,
    }, { status: 500 });
  }
}