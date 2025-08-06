// /lib/scraper.js

import playwright, { type Browser } from 'playwright-core';
import chromium from '@sparticuz/chromium-min';
import { google } from 'googleapis';

async function getAuthCodeFromGmail(): Promise<string | null> {
  console.log('Fetching 2FA code from Gmail using OAuth 2.0...');
  try {
    // 1. 환경 변수에서 OAuth 2.0 정보 가져오기
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
      throw new Error('Google OAuth 2.0 credentials are not fully set in .env.local');
    }

    // 2. OAuth2 클라이언트 생성 및 인증 정보 설정
    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      'https://developers.google.com/oauthplayground' // 리디렉션 URI는 토큰 발급 시 사용한 것과 일치해야 함
    );

    oauth2Client.setCredentials({
      refresh_token: GOOGLE_REFRESH_TOKEN,
    });

    // 3. Gmail API 클라이언트 생성
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // 4. SBI 증권 2FA 이메일 검색 (읽지 않은 메일, "認証コード" 제목)
    const listResponse = await gmail.users.messages.list({
      userId: 'me',
      q: 'from:info@sbisec.co.jp subject:認証コード is:unread',
      maxResults: 1,
    });

    if (!listResponse.data.messages || listResponse.data.messages.length === 0) {
      // 2FA 이메일이 없을 경우, 스크래핑할 필요가 없으므로 에러 대신 null을 반환하여 상위 로직에서 처리하도록 함
      console.log('No new 2FA email found from SBI Securities. It might not be a login attempt requiring 2FA.');
      return null;
    }

    const messageId = listResponse.data.messages[0].id!;

    // 5. 이메일 내용 가져오기
    const messageResponse = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });
    
    // 6. 이메일 본문에서 인증 코드 추출 (HTML 또는 Plain Text 지원)
    const payload = messageResponse.data.payload;
    if (!payload) throw new Error('Email payload is empty.');

    let bodyData: string | null | undefined = null;

    // 재귀적으로 이메일 파트를 탐색하여 text/plain 또는 text/html을 찾는 함수
    const findTextPart = (parts: any[]): any => {
      let foundPart = parts.find(part => part.mimeType === 'text/plain');
      if (foundPart) return foundPart;

      foundPart = parts.find(part => part.mimeType === 'text/html');
      if (foundPart) return foundPart;
      
      for (const part of parts) {
        if (part.parts) {
          const nestedPart = findTextPart(part.parts);
          if (nestedPart) return nestedPart;
        }
      }
      return null;
    };

    let textPart: any = null;
    if (payload.parts) {
      textPart = findTextPart(payload.parts);
    } else if (payload.mimeType === 'text/plain' || payload.mimeType === 'text/html') {
      textPart = payload;
    }

    if (!textPart || !textPart.body || !textPart.body.data) {
      const availableMimeTypes = payload.parts?.map(p => p.mimeType).join(', ') || payload.mimeType;
      throw new Error(`Could not find 'text/plain' or 'text/html' part. Available types: [${availableMimeTypes}]`);
    }

    const body = textPart.body.data;
    const decodedBody = Buffer.from(body, 'base64').toString('utf-8');
    
    const authCodeMatch = decodedBody.match(/■認証コード\s+([A-Z0-9]{6})/);
    if (!authCodeMatch || !authCodeMatch[1]) {
      // HTML 태그 제거 후 다시 시도 (HTML 이메일의 경우를 대비)
      const plainTextBody = decodedBody.replace(/<[^>]*>/g, '\n');
      const retryMatch = plainTextBody.match(/■認証コード\s+([A-Z0-9]{6})/);
      if (!retryMatch || !retryMatch[1]) {
        throw new Error('Could not find the 6-character auth code in the email body. Body was: ' + decodedBody);
      }
      const authCode = retryMatch[1];
      console.log(`Fetched 2FA code: ${authCode}`);
      return authCode;
    }
    
    const authCode = authCodeMatch[1];
    console.log(`Fetched 2FA code: ${authCode}`);
    return authCode;

  } catch (error: any) {
    console.error('Failed to get auth code from Gmail:', error);
    // API 관련 에러일 경우, 더 자세한 정보 출력
    if (error.response) {
      console.error('API Error Details:', error.response.data.error);
    }
    throw error;
  }
}

interface DividendResult {
  text: string;
  source: string;
}

export async function scrapeDividend(options?: { testMode?: 'get-2fa-code' }): Promise<DividendResult | null> {
  let browser: Browser | null = null;
  console.log('Starting dividend scraping process...');

  try {
    const isDebugMode = process.env.PWDEBUG === '1';

    if (isDebugMode) {
      console.log('Running in local debug mode. Launching local browser...');
      browser = await playwright.chromium.launch({ headless: false });
    } else {
      console.log('Running in Vercel/production mode. Launching Spaticuz Chromium...');
      browser = await playwright.chromium.launch({
        args: chromium.args,
        executablePath: await chromium.executablePath(process.env.NODE_ENV === 'development' ? undefined : 'https://github.com/Sparticuz/chromium/releases/download/v123.0.1/chromium-v123.0.1-pack.tar'),
        headless: (chromium as any).headless,
      });
    }

    const context = await browser.newContext();
    const page = await context.newPage();

    // 1. SBI 증권 로그인 페이지로 이동
    console.log('Navigating to SBI login page...');
    await page.goto('https://www.sbisec.co.jp/ETGate/?_ControlID=WPLETlgR001Control&_PageID=WPLETlgR001Rlgn50&_DataStoreID=DSWPLETlgR001Control&_ActionID=login&getFlg=on');

    // ★★★ 디버깅을 위해 여기서 실행을 일시 중지합니다. ★★★
    await page.pause();

    // 2. 아이디와 비밀번호 입력
    await page.fill('input[name="user_id"]', process.env.SBI_ID!);
    await page.fill('input[name="user_password"]', process.env.SBI_PASSWORD!);

    // 로그인 버튼 클릭과 페이지 이동을 함께 기다립니다.
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
        page.click('button[name="ACT_loginHome"]'),
    ]);
    console.log('Logged in with ID/Password.');

    // --- 새로운 디바이스 인증 단계 시작 ---
    console.log('Navigated to device authentication page.');

    // 화면에 표시된 2글자 인증 코드를 포함하는 요소가 나타날 때까지 기다립니다.
    const deviceAuthCodeElement = page.locator('#randomString');
    await deviceAuthCodeElement.waitFor();
    const deviceAuthCode = await deviceAuthCodeElement.textContent();

    if (!deviceAuthCode || deviceAuthCode.trim().length !== 2) {
        throw new Error(`Failed to extract 2-character device auth code. Found: ${deviceAuthCode}`);
    }
    const codeToEnter = deviceAuthCode.trim();
    console.log(`Device auth code found: ${codeToEnter}`);

    // 인증 코드를 입력 필드에 채웁니다.
    // ★★★ 중요: 아래 선택자는 실제 페이지와 다를 수 있습니다. ★★★
    await page.fill('input[name="userInput"]', codeToEnter);

    // "송신" 버튼을 클릭합니다. (페이지 이동을 기다리지 않습니다)
    // ★★★ 중요: 아래 선택자는 실제 페이지와 다를 수 있습니다. ★★★
    console.log('Submitting device authentication...');
    await page.click('input[value="送信"]'); // "송신" 버튼의 선택자
    console.log('Device auth popup submitted.');
    // --- 새로운 디바이스 인증 단계 종료 ---

    // 3. 2FA 코드 처리
    // 팝업이 닫히고 이메일 인증 코드 입력 필드가 나타날 때까지 기다립니다.
    await page.waitForSelector('input[name="device_code"]', { timeout: 5000 });
    console.log('2FA page detected.');

    // "Eメールの記載との一致を確認しました" 체크박스를 클릭합니다.
    await page.check('input[name="device_string_checkbox"]');
    console.log('Checked the confirmation checkbox.');

    const authCode = await getAuthCodeFromGmail();
    if (!authCode) {
      console.log('Auth code not found, aborting scrape.');
      return null;
    }

    // ★★★ 테스트 모드 분기 ★★★
    if (options?.testMode === 'get-2fa-code') {
      console.log(`[Test Mode] Successfully fetched 2FA code: ${authCode}. Halting execution as planned.`);
      return {
        text: `[테스트 성공] 2FA 인증 코드를 성공적으로 가져왔습니다: ${authCode}`,
        source: 'test-mode: get-2fa-code'
      };
    }

    await page.fill('input[name="device_code"]', authCode);
    console.log('Submitted 2FA code.');

    // 4. 배당금 이력 페이지로 이동 (오늘 날짜 기준으로 동적 URL 생성)
    console.log('Generating dynamic URL for today\'s dividend history...');

    const today = new Date();
    const year = today.getFullYear();
    const month = (today.getMonth() + 1).toString().padStart(2, '0');
    const day = today.getDate().toString().padStart(2, '0');

    const todayDate = `${year}/${month}/${day}`;

    // 시작일, 종료일, 그리고 period=TODAY를 모두 포함한 URL 생성
    const dividendUrl = `https://site.sbisec.co.jp/account/assets/dividends?dispositionDateFrom=${todayDate}&dispositionDateTo=${todayDate}&period=TODAY`;

    console.log(`Navigating to: ${dividendUrl}`);
    await page.goto(dividendUrl);

    // 5. 최신 배당금 정보 추출 (플레이스홀더)
    console.log('Scraping dividend information...');
    const dividendInfo = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll<HTMLElement>('.site-box-line table tr'));
      const latestDividend = rows.find(row => row.innerText.includes('配当金'));
      return latestDividend ? latestDividend.innerText : 'No new dividend found.';
    });

    console.log('Scraping finished.');
    return {
      text: dividendInfo,
      source: 'SBI Securities'
    };

  } catch (error) {
    console.error('Scraping failed:', error);
    throw new Error('Failed to scrape dividend information.');
  } finally {
    if (browser) {
      await browser.close();
      console.log('Browser closed.');
    }
  }
}
