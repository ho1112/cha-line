// /app/api/test-scrape/route.ts
// 목적: SBI 로그인 -> 2FA 코드 가져오기까지의 과정을 테스트합니다.
// 사용법: 브라우저에서 https://<YOUR_APP_URL>/api/test-scrape 으로 접속하면 즉시 실행됩니다.
// 결과: 성공 시 2FA 코드를, 실패 시 에러 메시지를 브라우저에 JSON 형태로 보여줍니다.

import { NextRequest, NextResponse } from 'next/server';
import { scrapeDividend } from '../../../lib/scraper';

export async function GET(request: NextRequest) {
  console.log('Executing scraping test in "get-2fa-code" mode...');
  
  try {
    // 1. 2FA 코드 가져오기 테스트 모드로 스크래핑 함수 실행
    const result = await scrapeDividend({ testMode: 'get-2fa-code' });

    if (result) {
      // 2. 성공 시, 가져온 2FA 코드(또는 메시지)를 브라우저에 반환
      console.log('Scraping test (get-2fa-code) successful.');
      return NextResponse.json({
        status: 'success',
        message: '성공적으로 2FA 코드를 가져왔습니다.',
        data: result,
      });
    } else {
      // scrapeDividend가 null을 반환한 경우 (예: 2FA 메일 없음)
      console.log('Scraping test finished, but no 2FA email was found.');
      return NextResponse.json({
        status: 'no_action',
        message: '스크래핑은 정상적으로 실행되었으나, 처리할 2FA 이메일을 찾지 못했습니다.',
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
