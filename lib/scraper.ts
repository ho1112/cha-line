// /lib/scraper.ts

import playwright, { type Browser } from 'playwright-core';
import chromium from '@sparticuz/chromium-min';
import { google } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import * as iconv from 'iconv-lite';

async function getAuthUrlFromGmail(): Promise<string | null> {
  console.log('Fetching Auth URL from Gmail...');
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
      'https://developers.google.com/oauthplayground'
    );
    oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });

    // 3. Gmail API 클라이언트 생성
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // 4. SBI 증권 인증 URL 이메일 검색 (제목 변경)
    const listResponse = await gmail.users.messages.list({
      userId: 'me',
      q: 'from:info@sbisec.co.jp subject:認証コード入力画面のお知らせ is:unread',
      maxResults: 1,
    });

    if (!listResponse.data.messages || listResponse.data.messages.length === 0) {
      console.log('No new auth URL email found.');
      return null;
    }

    const messageId = listResponse.data.messages[0].id!;

    // 5. 이메일 내용 가져오기
    const messageResponse = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    const payload = messageResponse.data.payload;
    if (!payload) throw new Error('Email payload is empty.');

    // 6. 이메일 본문에서 인증 URL 추출 (로직 변경)
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

    // URL을 추출하기 위한 정규식 (https로 시작하고 큰따옴표/공백 전까지)
    const urlMatch = decodedBody.match(/(https:\/\/[^\s"]+)/);
    if (!urlMatch || !urlMatch[0]) {
      throw new Error('Could not find the auth URL in the email body.');
    }

    const authUrl = urlMatch[0];
    console.log(`Fetched Auth URL: ${authUrl}`);
    return authUrl;

  } catch (error: any) {
    console.error('Failed to get auth URL from Gmail:', error);
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

export async function scrapeDividend(): Promise<DividendResult | null> {
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

    // 3. 새로운 디바이스 인증 로직 (2025/8/9 이후 사양)
    console.log('Starting new device authentication flow...');

    // "Eメールを送信する" 버튼 클릭하여 인증 URL 이메일 발송 요청
    await page.click('button:has-text("Eメールを送信する")');
    console.log('Clicked "Send Email" button.');

    // 웹사이트의 인증 코드와 이메일의 인증 URL을 동시에 가져오기
    const [webAuthCode, authUrl] = await Promise.all([
        // 작업 (A): 웹사이트에서 화면에 표시된 인증 코드 가져오기
        (async () => {
            // ★★★ 중요: 아래 선택자는 실제 페이지와 다를 수 있습니다. ★★★
            const codeElement = page.locator('#device_auth_code_display_element');
            await codeElement.waitFor();
            const code = await codeElement.textContent();
            if (!code) throw new Error('Could not find auth code on the web page.');
            console.log(`Auth code from web: ${code.trim()}`);
            return code.trim();
        })(),
        // 작업 (B): 이메일에서 인증 URL 가져오기
        getAuthUrlFromGmail()
    ]);

    if (!authUrl) {
        throw new Error('Failed to get auth URL from Gmail.');
    }

    // 4. 새 탭에서 인증 URL 열고 코드 입력
    console.log(`Opening auth URL in a new tab: ${authUrl}`);
    const authPage = await context.newPage();
    await authPage.goto(authUrl);

    // ★★★ 중요: 아래 선택자는 실제 페이지와 다를 수 있습니다. ★★★
    await authPage.fill('input[name="authentication_code_input"]', webAuthCode);
    await authPage.click('button:has-text("認証する")');
    console.log('Submitted auth code on the auth page.');
    await authPage.close(); // 인증 후 탭 닫기

    // 5. 원래 페이지로 돌아와서 최종 등록
    console.log('Returned to the original page to finalize registration.');
    // ★★★ 중요: 아래 선택자는 실제 페이지와 다를 수 있습니다. ★★★
    await page.check('input[name="confirmation_checkbox"]'); // "確認しました" 체크박스
    await page.click('button:has-text("デバイスを登録する")'); // "デバイスを登録する" 버튼
    console.log('Device registration complete.');

    // 최종적으로 페이지 이동이 완료될 때까지 기다립니다.
    await page.waitForNavigation({ waitUntil: 'domcontentloaded' });

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

    // 5. 최신 배당금 정보 추출 (CSV 다운로드 방식)
    console.log('Scraping dividend information via CSV download...');

    // CSV 다운로드 버튼 클릭과 다운로드 이벤트를 동시에 기다립니다.
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        // ★★★ 중요: 아래 선택자는 실제 페이지와 다를 수 있습니다. Inspector로 정확한 값을 찾아야 합니다. ★★★
        page.click('#csv_download_button'),
    ]);

    // 다운로드된 파일의 임시 경로를 가져옵니다.
    const tempFilePath = await download.path();
    if (!tempFilePath) {
        throw new Error('Failed to get temporary file path for download.');
    }
    console.log(`File downloaded to temporary path: ${tempFilePath}`);

    // CSV 파일을 Shift_JIS 인코딩으로 읽고 파싱합니다.
    const fileBuffer = fs.readFileSync(tempFilePath);
    const csvData = iconv.decode(fileBuffer, 'Shift_JIS');
    const records = parse(csvData, {
        columns: true, // 첫 번째 줄을 헤더로 사용
        skip_empty_lines: true,
    });

    // 임시 파일을 삭제합니다.
    fs.unlinkSync(tempFilePath);
    console.log('Temporary file deleted.');

    if (records.length === 0) {
        console.log('CSV file was empty. No new dividend found.');
        return {
            text: '금일 신규 배당금 내역이 없습니다.',
            source: 'SBI Securities (CSV)'
        };
    }

    // 파싱된 데이터를 기반으로 알림 메시지를 생성합니다.
    const dividendMessages = records.map((record: any) => {
        // ★★★ 중요: 아래 키(key) 값들은 실제 CSV 헤더와 다를 수 있습니다. ★★★
        const stockName = record['銘柄名'];
        const amount = record['受取額(税引後・円)'];
        const date = record['受渡日'];
        return `- ${stockName}: ${amount}원 (입금일: ${date})`;
    });

    const combinedMessage = dividendMessages.join('\n');
    console.log(`Scraping finished. Found ${records.length} items.`);
    
    return {
        text: combinedMessage,
        source: 'SBI Securities (CSV)'
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
