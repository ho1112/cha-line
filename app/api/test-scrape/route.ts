// /app/api/test-scrape/route.ts
// 목적: SBI 로그인 -> 2FA 코드 가져오기까지의 과정을 테스트합니다.
// 사용법: 브라우저에서 https://<YOUR_APP_URL>/api/test-scrape 으로 접속하면 즉시 실행됩니다.
// 결과: 성공 시 2FA 코드를, 실패 시 에러 메시지를 브라우저에 JSON 형태로 보여줍니다.

import { NextRequest, NextResponse } from 'next/server';
import { scrapeDividend, checkLoginPage } from '@/lib/scraper';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode') || 'login-page';

  try {
    if (mode === 'login-page') {
      const prefill = searchParams.get('prefill') === 'true';
      const result = await checkLoginPage({ prefillCredentials: prefill });
      return NextResponse.json({ status: result.ok ? 'success' : 'fail', mode, result });
    }

    if (mode === 'full') {
      const adminSecret = request.headers.get('x-admin-secret');
      if (!adminSecret || adminSecret !== process.env.ADMIN_SECRET) {
        return NextResponse.json({ status: 'unauthorized', message: 'Invalid admin secret' }, { status: 401 });
      }
      const result = await scrapeDividend();
      return NextResponse.json({ status: result ? 'success' : 'no_action', mode, result });
    }

    return NextResponse.json({ status: 'error', message: `Unknown mode: ${mode}` }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ status: 'error', message: error.message }, { status: 500 });
  }
}
