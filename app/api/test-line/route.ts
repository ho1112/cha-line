// /app/api/test-line/route.ts
// 목적: 스크래핑 없이 LINE 알림 기능만 독립적으로 테스트합니다.
// 사용법: 브라우저에서 https://<YOUR_APP_URL>/api/test-line 으로 접속하면 즉시 실행됩니다.

import { NextRequest, NextResponse } from 'next/server';
import { sendLineMessage, sendErrorMessage } from '../../../lib/notification';

export async function GET(request: NextRequest) {
  console.log('Executing LINE notification test...');

  try {
    // 1. 테스트용 성공 데이터 생성
    const testDividendData = {
      text: '[테스트] 삼성전자로부터 배당금 10,000원이 입금되었습니다.',
      source: 'Test Data',
    };

    // 2. 성공 메시지 전송 테스트
    await sendLineMessage(testDividendData);
    console.log('Test success message sent.');

    // 3. 테스트용 에러 메시지 생성
    const testErrorMessage = '이것은 에러 알림 테스트입니다. 실제 에러가 아닙니다.';

    // 4. 에러 메시지 전송 테스트
    await sendErrorMessage(testErrorMessage);
    console.log('Test error message sent.');

    return NextResponse.json({
      status: 'success',
      message: 'LINE으로 2개의 테스트 메시지(성공, 에러)를 전송했습니다. LINE 앱을 확인해주세요.',
    });
  } catch (error: any) {
    console.error('LINE test failed:', error);
    return NextResponse.json({
      status: 'error',
      message: 'LINE 테스트 메시지 전송 중 에러가 발생했습니다.',
      error: error.message,
    }, { status: 500 });
  }
}
