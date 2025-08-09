// /app/api/test-scrape/route.ts
// 목적: SBI 로그인 -> 2FA 코드 가져오기까지의 과정을 테스트합니다.
// 사용법: 브라우저에서 https://<YOUR_APP_URL>/api/test-scrape 으로 접속하면 즉시 실행됩니다.
// 결과: 성공 시 2FA 코드를, 실패 시 에러 메시지를 브라우저에 JSON 형태로 보여줍니다.

import { NextRequest, NextResponse } from 'next/server';
import { scrapeDividend } from '@/lib/scraper';

export async function GET(request: NextRequest) {
  console.log('Executing scraping test in "get-2fa-code" mode...');
  
  try {
    // 1. 스크래핑 함수 실행 (testMode 제거)
    const result = await scrapeDividend();

    if (result) {
      // 2. 성공 시, 스크래핑 결과를 브라우저에 반환
      console.log('Scraping test successful.');
      return NextResponse.json({
        status: 'success',
        message: '스크래핑 테스트에 성공했습니다.',
        data: result,
      });
    } else {
      // scrapeDividend가 null을 반환한 경우
      console.log('Scraping test finished, but no data was returned.');
      return NextResponse.json({
        status: 'no_action',
        message: '스크래핑은 정상적으로 실행되었으나, 반환된 데이터가 없습니다.',
      });
    }

  } catch (error: any) {
    console.error('Scraping test (get-2fa-code) failed:', error);
    // 3. 에러 발생 시, 에러 정보를 브라우저에 반환
    return NextResponse.json({
      status: 'error',
      message: '2FA 코드 가져오기 테스트 중 에러가 발생했습니다.',
      error: error.message,
    }, { status: 500 });
  }
}
