// /lib/scraper.js

import playwright from 'playwright-core';
import chromium from '@sparticuz/chromium-min';
import { google } from 'googleapis';

async function getAuthCodeFromGmail() {
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

    const messageId = listResponse.data.messages[0].id;

    // 5. 이메일 내용 가져오기
    const messageResponse = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });
    
    // 6. 이메일 본문에서 인증 코드 추출
    const bodyPart = messageResponse.data.payload.parts.find(part => part.mimeType === 'text/plain');
    if (!bodyPart || !bodyPart.body || !bodyPart.body.data) {
        throw new Error('Could not find plain text part in the email body.');
    }
    const body = bodyPart.body.data;
    const decodedBody = Buffer.from(body, 'base64').toString('utf-8');
    
    const authCodeMatch = decodedBody.match(/認証コード：(\d{6})/);
    if (!authCodeMatch || !authCodeMatch[1]) {
      throw new Error('Could not find the 6-digit auth code in the email body.');
    }
    
    const authCode = authCodeMatch[1];
    console.log(`Fetched 2FA code: ${authCode}`);
    return authCode;

  } catch (error) {
    console.error('Failed to get auth code from Gmail:', error);
    // API 관련 에러일 경우, 더 자세한 정보 출력
    if (error.response) {
      console.error('API Error Details:', error.response.data.error);
    }
    throw error;
  }
}

export async function scrapeDividend() {
  let browser = null;
  console.log('Starting dividend scraping process...');

  try {
    // Vercel 환경에 최적화된 Chromium 실행
    browser = await playwright.chromium.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(process.env.NODE_ENV === 'development' ? undefined : 'https://github.com/Sparticuz/chromium/releases/download/v123.0.1/chromium-v123.0.1-pack.tar'),
      headless: chromium.headless,
    });

    const context = await browser.newContext();
    const page = await context.newPage();

    // 1. SBI 증권 로그인 페이지로 이동
    console.log('Navigating to SBI login page...');
    await page.goto('https://www.sbisec.co.jp/ETGate');

    // 2. 아이디와 비밀번호 입력
    await page.fill('input[name="user_id"]', process.env.SBI_ID);
    await page.fill('input[name="user_password"]', process.env.SBI_PASSWORD);
    await page.click('input[name="ACT_login"]');
    console.log('Logged in with ID/Password.');

    // 3. 2FA 코드 처리
    await page.waitForSelector('input[name="i_authentication_word"]', { timeout: 5000 });
    console.log('2FA page detected.');
    const authCode = await getAuthCodeFromGmail();
    await page.fill('input[name="i_authentication_word"]', authCode);
    await page.click('input[name="ACT_2fa_login"]');
    console.log('Submitted 2FA code.');

    // 4. 입출금 명세 페이지로 이동
    await page.waitForNavigation();
    console.log('Navigating to transaction history page...');
    await page.goto('https://site2.sbisec.co.jp/Account/Syoukai/foreign_cash_balance.asp');

    // 5. 최신 배당금 정보 추출 (플레이스홀더)
    console.log('Scraping dividend information...');
    const dividendInfo = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.site-box-line table tr'));
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
