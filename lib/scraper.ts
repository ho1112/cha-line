// /lib/scraper.ts

import playwright, { type Browser } from 'playwright-core';
import chromium from '@sparticuz/chromium';
import { google } from 'googleapis';
import * as fs from 'fs';
import { parse } from 'csv-parse/sync';
import * as iconv from 'iconv-lite';
import { parseDividendCsvText } from './csv';
import { buildDividendFlex } from './flex';
import { sendFlexMessage } from './notification';

function getTodayJstYmd(): string {
  const dtf = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = dtf.formatToParts(new Date());
  const y = parts.find(p => p.type === 'year')!.value;
  const m = parts.find(p => p.type === 'month')!.value;
  const d = parts.find(p => p.type === 'day')!.value;
  return `${y}/${m}/${d}`;
}

export async function checkLoginPage(options?: { prefillCredentials?: boolean }): Promise<{
  ok: boolean;
  title: string;
  selectors: { [key: string]: boolean };
  url: string;
  prefilled?: boolean;
}> {
  let browser: Browser | null = null;
  const loginUrl = 'https://www.sbisec.co.jp/ETGate/?_ControlID=WPLETlgR001Control&_PageID=WPLETlgR001Rlgn50&_DataStoreID=DSWPLETlgR001Control&_ActionID=login&getFlg=on';
  try {
    const isDebugMode = process.env.PWDEBUG === '1';
    if (isDebugMode) {
      const localChromePath = process.env.LOCAL_CHROME_PATH;
      if (localChromePath) {
        browser = await playwright.chromium.launch({ headless: false, executablePath: localChromePath });
      } else {
        try {
          browser = await playwright.chromium.launch({ headless: false, channel: 'chrome' });
        } catch (e) {
          // macOS 기본 경로로 폴백
          browser = await playwright.chromium.launch({ headless: false, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
        }
      }
    } else {
      browser = await playwright.chromium.launch({
        args: chromium.args,
        executablePath: await chromium.executablePath(),
        headless: (chromium as any).headless,
      });
    }

    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });

    const requiredSelectors = [
      'input[name="user_id"]',
      'input[name="user_password"]',
      'button[name="ACT_loginHome"]',
    ];

    const results: { [key: string]: boolean } = {};
    for (const sel of requiredSelectors) {
      results[sel] = (await page.$(sel)) !== null;
    }

    // 선택적으로 자격증명만 입력(로그인 버튼은 누르지 않음)
    let prefilled = false;
    if (options?.prefillCredentials) {
      const userId = process.env.SBI_ID;
      const userPw = process.env.SBI_PASSWORD;
      if (userId && userPw) {
        await page.fill('input[name="user_id"]', userId);
        await page.fill('input[name="user_password"]', userPw);
        prefilled = true;
      }
    }

    const title = await page.title();
    return { ok: Object.values(results).every(Boolean), title, selectors: results, url: loginUrl, prefilled };
  } catch (e) {
    return { ok: false, title: '', selectors: {}, url: loginUrl, prefilled: false };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

async function getAuthUrlFromGmail(options?: { sinceMs?: number; lastSeenMessageId?: string | null }): Promise<{ url: string; messageId: string } | null> {
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

    // 4. SBI 증권 인증 URL 이메일 검색 (읽음 여부 무관, 최근 n개 확인)
    const listResponse = await gmail.users.messages.list({
      userId: 'me',
      q: 'from:info@sbisec.co.jp subject:認証コード入力画面のお知らせ',
      maxResults: 5,
    });

    if (!listResponse.data.messages || listResponse.data.messages.length === 0) {
      console.log('No new auth URL email found.');
      return null;
    }

    // 5. 후보 메시지들에서 sinceMs 이후 수신된 메시지를 선택 (가장 최신 우선)
    const sinceMs = options?.sinceMs ?? 0;
    const lastSeen = options?.lastSeenMessageId ?? null;
    const skewMs = 1000; // 클럭 오차 보정
    let pickedId: string | null = null;
    let pickedPayload: any = null;
    for (const m of listResponse.data.messages) {
      const id = m.id!;
      if (lastSeen && id === lastSeen) continue;
      const resp = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
      const payload = resp.data.payload;
      const internalDateStr: any = (resp.data as any).internalDate; // epoch ms (string)
      const internalDate = internalDateStr ? Number(internalDateStr) : 0;
      if (payload && internalDate >= sinceMs - skewMs) {
        pickedId = id;
        pickedPayload = payload;
        break;
      }
    }
    if (!pickedId || !pickedPayload) {
      console.log('No matching auth URL email found after trigger time.');
      return null;
    }
    const messageId = pickedId;
    const payload = pickedPayload;

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
      const availableMimeTypes = payload.parts?.map((p: any) => p.mimeType).join(', ') || payload.mimeType;
      throw new Error(`Could not find 'text/plain' or 'text/html' part. Available types: [${availableMimeTypes}]`);
    }

    const body = textPart.body.data;
    const decodedBody = Buffer.from(body, 'base64').toString('utf-8');

    // HTML/PLAIN 분기: HTML인 경우 a[href]에서 직접 추출, 아니면 텍스트에서 패턴 매칭
    const isHtml = (textPart.mimeType === 'text/html') || (payload.mimeType === 'text/html');
    let authUrl: string | null = null;

    if (isHtml) {
      // <a href="https://m.sbisec.co.jp/deviceAuthentication/input?...&amp;...">
      const hrefMatch = decodedBody.match(/href="(https:\/\/m\.sbisec\.co\.jp\/deviceAuthentication\/input[^\"]+)"/i);
      if (hrefMatch && hrefMatch[1]) {
        authUrl = hrefMatch[1].replace(/&amp;/g, '&');
      } else {
        // 보조: data-saferedirecturl 안의 q 파라미터에서 추출 시도
        const saferedirectMatch = decodedBody.match(/data-saferedirecturl="https:\/\/www\.google\.com\/url\?q=(https?:[^"&]+)["&]/i);
        if (saferedirectMatch && saferedirectMatch[1]) {
          // HTML 엔티티 디코드
          const candidate = saferedirectMatch[1].replace(/&amp;/g, '&');
          authUrl = candidate;
        }
      }
    } else {
      // 텍스트 본문에서 직접 URL 추출 (목표 도메인 우선)
      const specificMatch = decodedBody.match(/(https:\/\/m\.sbisec\.co\.jp\/deviceAuthentication\/input[^\s\"]+)/);
      const genericMatch = decodedBody.match(/(https:\/\/[^\s\"]+)/);
      authUrl = (specificMatch && specificMatch[0]) || (genericMatch && genericMatch[0]) || null;
    }

    if (!authUrl) {
      throw new Error('Could not find the auth URL in the email body.');
    }
    console.log(`Fetched Auth URL: ${authUrl}`);
    return { url: authUrl, messageId };

  } catch (error: any) {
    console.error('Failed to get auth URL from Gmail:', error);
    if (error.response) {
      console.error('API Error Details:', error.response.data.error);
    }
    throw error;
  }
}

async function waitForAuthUrlFromGmail(options?: { timeoutMs?: number; pollIntervalMs?: number; sinceMs?: number }): Promise<{ url: string; messageId: string }> {
  const timeoutMs = options?.timeoutMs ?? 35000; // 코드는 40초 주기 → 여유를 두고 35초 타임아웃
  const pollMs = options?.pollIntervalMs ?? 1500;
  const sinceMs = options?.sinceMs ?? 0;
  const start = Date.now();
  let lastSeen: string | null = null;
  while (Date.now() - start < timeoutMs) {
    const found = await getAuthUrlFromGmail({ sinceMs, lastSeenMessageId: lastSeen }).catch(() => null);
    if (found) return found;
    await new Promise(res => setTimeout(res, pollMs));
  }
  throw new Error(`Timed out waiting for auth URL from Gmail (>${timeoutMs}ms)`);
}

interface DividendResult {
  text: string;
  source: string;
}

export async function scrapeDividend(options: { debugAuthOnly?: boolean; overrideDates?: { from?: string; to?: string } } = {}): Promise<DividendResult | null> {
  let browser: Browser | null = null;
  console.log('Starting dividend scraping process...');

  try {
    const isDebugMode = process.env.PWDEBUG === '1';

    if (isDebugMode) {
      console.log('Running in local debug mode. Launching system Chrome...');
      const localChromePath = process.env.LOCAL_CHROME_PATH;
      if (localChromePath) {
        browser = await playwright.chromium.launch({ headless: false, executablePath: localChromePath });
      } else {
        try {
          browser = await playwright.chromium.launch({ headless: false, channel: 'chrome' });
        } catch (e) {
          browser = await playwright.chromium.launch({ headless: false, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
        }
      }
    } else {
      console.log('Running in Vercel/production mode. Launching Sparticuz Chromium...');
      browser = await playwright.chromium.launch({
        args: chromium.args,
        executablePath: await chromium.executablePath(),
        headless: (chromium as any).headless,
      });
    }

    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();

    // 1. SBI 증권 로그인 페이지로 이동
    console.log('Navigating to SBI login page...');
    await page.goto('https://www.sbisec.co.jp/ETGate/?_ControlID=WPLETlgR001Control&_PageID=WPLETlgR001Rlgn50&_DataStoreID=DSWPLETlgR001Control&_ActionID=login&getFlg=on');

    // 로그인 페이지 진입 완료

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
    // 인증 이메일 발송 버튼 클릭 직전
    await page.click('button:has-text("Eメールを送信する")');
    console.log('Clicked "Send Email" button.');

    // 이메일에서 인증 URL을 기다림 (폴링 + 타임아웃)
    // 트리거 시각 이후에 도착한 메일만 대상
    const triggerMs = Date.now();
    const found = await waitForAuthUrlFromGmail({ sinceMs: triggerMs });
    const authUrl = found.url;

    // 4. 새 탭에서 인증 URL 열고 코드 입력
    console.log(`Opening auth URL in a new tab: ${authUrl}`);
    const authPage = await context.newPage();
    await authPage.goto(authUrl);

    // 인증 페이지 도착

    // ★★★ 중요: 아래 선택자는 실제 페이지와 다를 수 있습니다. ★★★
    // 코드는 40초마다 변경되므로, 입력 직전에 최신 값을 다시 읽어온다
    const codeElement = page.locator('#code-display');
    await codeElement.waitFor();
    const latestCode = (await codeElement.textContent())?.trim();
    if (!latestCode) throw new Error('Could not read the latest auth code from the web page.');
    await authPage.fill('input[name="verifyCode"]', latestCode);
    await authPage.click('button:has-text("認証する")');
    console.log('Submitted auth code on the auth page.');
    await authPage.close(); // 인증 후 탭 닫기

    // 5. 원래 페이지로 돌아와서 최종 등록
    console.log('Returned to the original page to finalize registration.');
    // 체크박스 체크 → 버튼 활성화 → 등록 버튼 클릭
    await page.waitForSelector('#device-checkbox');
    if (!(await page.isChecked('#device-checkbox'))) {
      await page.check('#device-checkbox');
    }

    await page.waitForSelector('#device-auth-otp');
    // 최종 등록 버튼 클릭 직전
    await page.click('#device-auth-otp');
    console.log('Device registration complete.');

    // 최종적으로 페이지 이동이 완료될 때까지 기다립니다.
    await page.waitForNavigation({ waitUntil: 'domcontentloaded' });

    if (options.debugAuthOnly) {
      console.log('[DEBUG] Auth-only mode enabled, skipping CSV download.');
      return {
        text: '장치 인증까지 완료(디버그 모드).',
        source: 'SBI Securities (AuthOnly)'
      };
    }

    // 4. 배당금 이력 페이지로 이동 (항상 날짜 파라미터만 사용)
    console.log('Generating dynamic URL for dividend history...');

    // 요청 바디 우선, 다음 ENV, 없으면 JST 오늘
    const bodyFrom = options.overrideDates?.from; // yyyy/mm/dd
    const bodyTo = options.overrideDates?.to;     // yyyy/mm/dd
    const envFrom = process.env.SCRAPE_FROM;      // yyyy/mm/dd
    const envTo = process.env.SCRAPE_TO;          // yyyy/mm/dd

    let dispositionDateFrom: string;
    let dispositionDateTo: string;
    const from = bodyFrom ?? envFrom;
    const to = bodyTo ?? envTo;
    if (from && to) {
      dispositionDateFrom = from;
      dispositionDateTo = to;
    } else {
      const todayDate = getTodayJstYmd();
      dispositionDateFrom = todayDate;
      dispositionDateTo = todayDate;
    }

    const baseUrl = 'https://site.sbisec.co.jp/account/assets/dividends';
    // 항상 날짜 파라미터만 포함
    const dividendUrl = `${baseUrl}?dispositionDateFrom=${dispositionDateFrom}&dispositionDateTo=${dispositionDateTo}`;

    console.log(`Navigating to: ${dividendUrl}`);
    await page.goto(dividendUrl);

    // 5. 최신 배당금 정보 추출 (CSV 다운로드 방식)
    console.log('Scraping dividend information via CSV download...');

    // CSV 다운로드 버튼 클릭과 다운로드 이벤트를 동시에 기다립니다.
    // 1차: 역할 기반 버튼(접근성 네임)으로 매칭, 2차: CSS 텍스트 매칭으로 폴백
    let downloadButton = page.getByRole('button', { name: /CSVダウンロード/ });
    try {
      await downloadButton.waitFor({ state: 'visible' });
    } catch {
      // 폴백 셀렉터
      downloadButton = page.locator('button.text-xs.link-light:has-text("CSVダウンロード")');
      await downloadButton.waitFor({ state: 'visible' });
    }

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      downloadButton.click(),
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
    const parsed = parseDividendCsvText(csvData);
    const records = parsed.items;

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
    console.log(`Scraping finished. Found ${records.length} items.`);

    // 운영도 Flex로 전송
    const flex = buildDividendFlex(parsed);
    await sendFlexMessage(flex, '배당 알림');
    return {
      text: 'Flex message sent',
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
