// /lib/scraper.ts

import edgeChromium from 'chrome-aws-lambda';
import puppeteer from 'puppeteer-core';
import { google } from 'googleapis';
import * as fs from 'fs';
import { parse } from 'csv-parse/sync';
import * as iconv from 'iconv-lite';
import { parseDividendCsvText } from './csv';
import * as path from 'path';
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
  let browser: any = null;
  const loginUrl = 'https://www.sbisec.co.jp/ETGate/?_ControlID=WPLETlgR001Control&_PageID=WPLETlgR001Rlgn50&_DataStoreID=DSWPLETlgR001Control&_ActionID=login&getFlg=on';
  try {
    const isDebugMode = process.env.PWDEBUG === '1';
    const remoteWsEndpoint = process.env.BROWSER_WS_ENDPOINT;
    if (isDebugMode) {
      const localChromePath = process.env.LOCAL_CHROME_PATH;
      if (localChromePath) {
        browser = await puppeteer.launch({ headless: false, executablePath: localChromePath });
      } else {
        try {
          browser = await puppeteer.launch({ headless: false });
        } catch (e) {
          // macOS 기본 경로로 폴백
          browser = await puppeteer.launch({ headless: false, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
        }
      }
    } else {
      // Vercel 환경에서 chrome-aws-lambda 사용
      const executablePath = await edgeChromium.executablePath;
      browser = await puppeteer.launch({
        args: edgeChromium.args,
        executablePath,
        headless: edgeChromium.headless,
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

    // 4. SBI 증권 인증 URL 이메일 검색 (더 유연한 검색 조건)
    console.log('Searching for SBI authentication emails...');
    
    // 여러 검색 조건 시도 (더 광범위하게)
    const searchQueries = [
      'from:info@sbisec.co.jp subject:認証コード入力画面のお知らせ',
      'from:sbisec.co.jp subject:認証',
      'from:sbisec.co.jp subject:認証コード',
      'from:sbisec.co.jp',
      'subject:認証コード',
      'subject:認証',
      'from:sbisec.co.jp newer_than:1d', // 최근 1일 내 모든 SBI 이메일
      'newer_than:1h' // 최근 1시간 내 모든 이메일 (최후의 수단)
    ];
    
    let listResponse = null;
    let usedQuery = '';
    
    for (const query of searchQueries) {
      try {
        console.log(`Trying search query: ${query}`);
        listResponse = await gmail.users.messages.list({
          userId: 'me',
          q: query,
          maxResults: 10, // 더 많은 결과 검색
        });
        
        if (listResponse.data.messages && listResponse.data.messages.length > 0) {
          usedQuery = query;
          console.log(`Found ${listResponse.data.messages.length} emails with query: ${query}`);
          
          // 디버깅: 첫 번째 이메일의 제목 확인
          try {
            const firstEmail = await gmail.users.messages.get({ 
              userId: 'me', 
              id: listResponse.data.messages[0].id!, 
              format: 'metadata',
              metadataHeaders: ['Subject', 'From', 'Date']
            });
            const subject = firstEmail.data.payload?.headers?.find(h => h.name === 'Subject')?.value;
            const from = firstEmail.data.payload?.headers?.find(h => h.name === 'From')?.value;
            const date = firstEmail.data.payload?.headers?.find(h => h.name === 'Date')?.value;
            console.log(`First email - Subject: ${subject}, From: ${from}, Date: ${date}`);
          } catch (e) {
            console.log('Could not read first email metadata:', e);
          }
          
          break;
        }
      } catch (e) {
        console.log(`Query failed: ${query}`, e);
        continue;
      }
    }
    
    if (!listResponse || !listResponse.data.messages || listResponse.data.messages.length === 0) {
      console.log('No emails found with any search query.');
      return null;
    }

    if (!listResponse.data.messages || listResponse.data.messages.length === 0) {
      console.log('No new auth URL email found.');
      return null;
    }

    // 5. 후보 메시지들에서 적절한 메시지 선택 (가장 최신 우선)
    const sinceMs = options?.sinceMs ?? 0;
    const lastSeen = options?.lastSeenMessageId ?? null;
    const skewMs = 1000; // 클럭 오차 보정
    
    console.log(`Looking for emails after: ${new Date(sinceMs).toISOString()}`);
    
    let pickedId: string | null = null;
    let pickedPayload: any = null;
    
    for (const m of listResponse.data.messages) {
      const id = m.id!;
      if (lastSeen && id === lastSeen) {
        console.log(`Skipping already seen message: ${id}`);
        continue;
      }
      
      const resp = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
      const payload = resp.data.payload;
      const internalDateStr: any = (resp.data as any).internalDate; // epoch ms (string)
      const internalDate = internalDateStr ? Number(internalDateStr) : 0;
      
      console.log(`Message ${id} date: ${new Date(internalDate).toISOString()}, sinceMs: ${new Date(sinceMs).toISOString()}`);
      
      // sinceMs 조건을 완화: 5분 전부터의 이메일도 허용
      const timeWindow = sinceMs - (5 * 60 * 1000); // 5분 전
      if (payload && internalDate >= timeWindow) {
        pickedId = id;
        pickedPayload = payload;
        console.log(`Selected message ${id} with date ${new Date(internalDate).toISOString()}`);
        break;
      }
    }
    
    if (!pickedId || !pickedPayload) {
      console.log('No matching auth URL email found within time window.');
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
  const timeoutMs = options?.timeoutMs ?? 60000; // 코드는 40초 주기 → 여유를 두고 60초 타임아웃
  const pollMs = options?.pollIntervalMs ?? 1000; // 폴링 간격 단축
  const sinceMs = options?.sinceMs ?? 0;
  const start = Date.now();
  let lastSeen: string | null = null;
  let attemptCount = 0;
  
  console.log(`Waiting for auth URL from Gmail (timeout: ${timeoutMs}ms, poll: ${pollMs}ms)`);
  
  while (Date.now() - start < timeoutMs) {
    attemptCount++;
    console.log(`Gmail search attempt ${attemptCount}...`);
    
    const found = await getAuthUrlFromGmail({ sinceMs, lastSeenMessageId: lastSeen }).catch(() => null);
    if (found) return found;
    
    const elapsed = Date.now() - start;
    console.log(`No auth URL found yet (elapsed: ${elapsed}ms, remaining: ${timeoutMs - elapsed}ms)`);
    
    await new Promise(res => setTimeout(res, pollMs));
  }
  throw new Error(`Timed out waiting for auth URL from Gmail (>${timeoutMs}ms)`);
}

interface DividendResult {
  text: string;
  source: string;
}

export async function scrapeDividend(options: { debugAuthOnly?: boolean; overrideDates?: { from?: string; to?: string } } = {}): Promise<DividendResult | null> {
  let browser: any = null;
  console.log('Starting dividend scraping process...');

  try {
    const isDebugMode = process.env.PWDEBUG === '1';
    
    if (isDebugMode) {
      console.log('Running in local debug mode. Launching system Chrome...');
      const localChromePath = process.env.LOCAL_CHROME_PATH;
      if (localChromePath) {
        browser = await puppeteer.launch({ headless: false, executablePath: localChromePath });
      } else {
        try {
          browser = await puppeteer.launch({ headless: false });
        } catch (e) {
          browser = await puppeteer.launch({ headless: false, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
        }
      }
    } else {
      console.log('Running in Vercel/production mode. Launching chrome-aws-lambda...');
      const executablePath = await edgeChromium.executablePath;
      browser = await puppeteer.launch({
        args: edgeChromium.args,
        executablePath,
        headless: edgeChromium.headless,
      });
    }

    if (!browser) {
      throw new Error('Failed to acquire a browser instance');
    }

    // 컨텍스트 생성
    console.log('Creating new browser context...');
    const context = await browser.newContext({ 
      acceptDownloads: true,
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    console.log('Browser context created successfully');
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

    // 3. 현재 페이지 상태 확인 (이미 디바이스 인증 페이지에 있음)
    console.log('Checking current page status...');
    
    // 페이지 안정화 대기
    await page.waitForLoadState('domcontentloaded');
    console.log('Page stabilized after login');
    
    // 안전하게 페이지 정보 읽기
    try {
      const currentUrl = await page.url();
      console.log('Current page URL:', currentUrl);
      
      const currentTitle = await page.title();
      console.log('Current page title:', currentTitle);
    } catch (e) {
      console.log('Could not read page info, but continuing...', e);
    }
    
    // 4. 새로운 디바이스 인증 로직 (2025/8/9 이후 사양)
    console.log('Starting new device authentication flow...');

    // 현재 페이지 상태 확인 및 디버깅 (안전하게)
    try {
      const currentUrl = await page.url();
      console.log('Current page URL:', currentUrl);
      
      const currentTitle = await page.title();
      console.log('Current page title:', currentTitle);
    } catch (e) {
      console.log('Could not read page info, but continuing...', e);
    }
    
    // 페이지 로딩 완료 대기 (networkidle 대신 더 간단한 방법 사용)
    await page.waitForLoadState('domcontentloaded');
    
    // 잠시 대기 (동적 콘텐츠 로딩을 위해)
    await page.waitForTimeout(2000);

    // "Eメールを送信する" 버튼 찾기 시도 (여러 방법으로)
    let emailButton = null;
    try {
      // 1차: 텍스트 기반
      emailButton = page.locator('button:has-text("Eメールを送信する")');
      await emailButton.waitFor({ state: 'visible', timeout: 5000 });
      console.log('Found email button by text');
    } catch (e) {
      console.log('Text-based button not found, trying alternative selectors...');
      try {
        // 2차: aria-label 기반
        emailButton = page.locator('[aria-label*="メール"], [aria-label*="email"]');
        await emailButton.waitFor({ state: 'visible', timeout: 5000 });
        console.log('Found email button by aria-label');
      } catch (e2) {
        try {
          // 3차: 일반적인 버튼 선택자
          emailButton = page.locator('button').filter({ hasText: /メール|email/i });
          await emailButton.waitFor({ state: 'visible', timeout: 5000 });
          console.log('Found email button by generic selector');
        } catch (e3) {
          console.log('All button finding methods failed. Current page content:');
          const pageContent = await page.content();
          console.log('Page HTML preview:', pageContent.substring(0, 1000));
          throw new Error('Could not find email button on the page');
        }
      }
    }

    // 버튼 클릭
    await emailButton.click();
    console.log('Clicked "Send Email" button.');

    // 이메일에서 인증 URL을 기다림 (폴링 + 타임아웃)
    // 트리거 시각 이후에 도착한 메일만 대상
    const triggerMs = Date.now();
    const found = await waitForAuthUrlFromGmail({ sinceMs: triggerMs });
    const authUrl = found.url;

    // 4. 새 탭에서 인증 URL 열고 코드 입력
    console.log(`Opening auth URL in a new tab: ${authUrl}`);
    
    // 새 페이지 생성
    let authPage = null;
    let authTabAttempts = 0;
    const maxAuthTabAttempts = 10; // 더 많은 시도
    
    while (authTabAttempts < maxAuthTabAttempts && !authPage) {
      try {
        authTabAttempts++;
        console.log(`Attempt ${authTabAttempts} to create auth tab...`);
        
        // 컨텍스트 상태 확인 (타입 안전하게)
        try {
          // 컨텍스트가 살아있는지 테스트
          await context.newPage();
          // 테스트 페이지 즉시 닫기
          const testPage = await context.newPage();
          await testPage.close();
        } catch (contextError) {
          console.log('Context test failed, cannot create new page:', contextError);
          throw new Error('Browser context is not working properly');
        }
        
        // 새 페이지 생성
        authPage = await context.newPage();
        console.log('Auth tab created successfully');
        
        // 인증 URL로 이동
        console.log('Navigating to auth URL...');
        await authPage.goto(authUrl, { 
          waitUntil: 'domcontentloaded', 
          timeout: 30000 
        });
        console.log('Successfully navigated to auth URL');
        break;
        
      } catch (e) {
        console.log(`Attempt ${authTabAttempts} failed:`, e);
        
        // 실패한 페이지 정리
        if (authPage) {
          try {
            await authPage.close();
          } catch (closeError) {
            console.log('Could not close failed auth page:', closeError);
          }
          authPage = null;
        }
        
        if (authTabAttempts >= maxAuthTabAttempts) {
          throw new Error(`Failed to create and navigate auth tab after ${maxAuthTabAttempts} attempts`);
        }
        
        // 더 긴 대기 시간
        console.log(`Waiting ${authTabAttempts * 1000}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, authTabAttempts * 1000));
      }
    }
    
    if (!authPage) {
      throw new Error('Could not create auth tab');
    }

    // 인증 페이지 도착

    // ★★★ 중요: 아래 선택자는 실제 페이지와 다를 수 있습니다. ★★★
    // 코드는 40초마다 변경되므로, 입력 직전에 최신 값을 다시 읽어온다
    console.log('Reading auth code from main page...');
    
    let codeElement = null;
    let codeAttempts = 0;
    const maxCodeAttempts = 10;
    
    while (codeAttempts < maxCodeAttempts && !codeElement) {
      try {
        codeAttempts++;
        console.log(`Attempt ${codeAttempts} to find code display element...`);
        
        // 메인 페이지 상태 확인
        try {
          await page.url(); // 페이지가 살아있는지 테스트
        } catch (pageError) {
          console.log('Main page test failed:', pageError);
          throw new Error('Main page was closed');
        }
        
        // 코드 요소 찾기
        codeElement = await page.waitForSelector('#code-display', { timeout: 10000 });
        console.log('Code display element found successfully');
        break;
      } catch (e) {
        console.log(`Attempt ${codeAttempts} failed:`, e);
        if (codeAttempts >= maxCodeAttempts) {
          throw new Error(`Failed to find code display element after ${maxCodeAttempts} attempts`);
        }
        // 점진적으로 대기 시간 증가
        const waitTime = Math.min(codeAttempts * 1000, 3000);
        console.log(`Waiting ${waitTime}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    
    if (!codeElement) {
      throw new Error('Could not find code display element');
    }
    
    // 코드 읽기
    const latestCode = (await codeElement.textContent())?.trim();
    if (!latestCode) throw new Error('Could not read the latest auth code from the web page.');
    console.log('Auth code read successfully:', latestCode);
    
    // 인증 코드 입력 필드가 활성화될 때까지 기다리기 (더 안전하게)
    console.log('Waiting for verification code input field to become enabled...');
    
    let inputField = null;
    let inputAttempts = 0;
    const maxInputAttempts = 10;
    
    while (inputAttempts < maxInputAttempts && !inputField) {
      try {
        inputAttempts++;
        console.log(`Attempt ${inputAttempts} to find enabled input field...`);
        
        // 인증 페이지 상태 확인
        try {
          await authPage.url(); // 페이지가 살아있는지 테스트
        } catch (pageError) {
          console.log('Auth page test failed:', pageError);
          throw new Error('Auth page was closed');
        }
        
        // 입력 필드 찾기
        inputField = await authPage.waitForSelector('input[name="verifyCode"]:not([disabled])', { timeout: 10000 });
        console.log('Verification code input field is now enabled');
        break;
      } catch (e) {
        console.log(`Attempt ${inputAttempts} failed:`, e);
        if (inputAttempts >= maxInputAttempts) {
          throw new Error(`Failed to find enabled input field after ${maxInputAttempts} attempts`);
        }
        // 점진적으로 대기 시간 증가
        const waitTime = Math.min(inputAttempts * 1000, 3000);
        console.log(`Waiting ${waitTime}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    
    if (!inputField) {
      throw new Error('Could not find enabled input field');
    }
    
    // 인증 코드 입력 및 제출
    try {
      await authPage.fill('input[name="verifyCode"]', latestCode);
      console.log('Auth code filled successfully');
      
      await authPage.click('button:has-text("認証する")');
      console.log('Submitted auth code on the auth page.');
    } catch (submitError) {
      console.log('Failed to submit auth code, trying JavaScript method:', submitError);
      // 대안 방법: JavaScript로 직접 입력 및 제출
      await authPage.evaluate((code) => {
        const input = document.querySelector('input[name="verifyCode"]') as HTMLInputElement;
        const button = document.querySelector('button:has-text("認証する")') as HTMLButtonElement;
        if (input) input.value = code;
        if (button) button.click();
      }, latestCode);
      console.log('Auth code submitted via JavaScript');
    }
    
    // 탭 B는 열어둔 상태로 유지 (자동으로 닫힐 수 있음)
    console.log('Auth code submitted, keeping auth tab open...');

    // 5. 원래 페이지로 돌아와서 최종 등록
    console.log('Returned to the original page to finalize registration.');
    
    // 메인 페이지 안정화 대기
    console.log('Waiting for main page to stabilize...');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000); // 추가 안정화 시간
    
    console.log('Main page stabilized, proceeding with device registration...');
    
    // 체크박스 체크 → 버튼 활성화 → 등록 버튼 클릭
    console.log('Looking for device checkbox...');
    
    // 체크박스 찾기
    let deviceCheckbox = null;
    let checkboxAttempts = 0;
    const maxCheckboxAttempts = 15; // 더 많은 시도
    
    while (checkboxAttempts < maxCheckboxAttempts && !deviceCheckbox) {
      try {
        checkboxAttempts++;
        console.log(`Attempt ${checkboxAttempts} to find device checkbox...`);
        
        // 페이지 상태 확인 (타입 안전하게)
        try {
          await page.url(); // 페이지가 살아있는지 테스트
        } catch (pageError) {
          console.log('Page test failed, cannot proceed:', pageError);
          throw new Error('Page was closed during device registration');
        }
        
        // 체크박스 찾기
        deviceCheckbox = await page.waitForSelector('#device-checkbox', { timeout: 10000 });
        console.log('Device checkbox found successfully');
        break;
      } catch (e) {
        console.log(`Attempt ${checkboxAttempts} failed:`, e);
        if (checkboxAttempts >= maxCheckboxAttempts) {
          throw new Error(`Failed to find device checkbox after ${maxCheckboxAttempts} attempts`);
        }
        // 점진적으로 대기 시간 증가
        const waitTime = Math.min(checkboxAttempts * 1000, 5000);
        console.log(`Waiting ${waitTime}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    
    if (!deviceCheckbox) {
      throw new Error('Device checkbox not found');
    }
    
    // 체크박스 체크 (안전하게)
    try {
      if (!(await page.isChecked('#device-checkbox'))) {
        await page.check('#device-checkbox');
        console.log('Device checkbox checked successfully');
      } else {
        console.log('Device checkbox was already checked');
      }
    } catch (checkError) {
      console.log('Failed to check checkbox, trying alternative method:', checkError);
      // 대안 방법: JavaScript로 직접 체크
      await page.evaluate(() => {
        const checkbox = document.getElementById('device-checkbox') as HTMLInputElement;
        if (checkbox && !checkbox.checked) {
          checkbox.checked = true;
          checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      console.log('Device checkbox checked via JavaScript');
    }
    
    // 체크박스 체크 후 버튼 활성화 대기
    console.log('Waiting for button to become active after checkbox...');
    await page.waitForTimeout(5000); // 5초 대기

    // 디바이스 등록 버튼을 안전하게 찾기
    console.log('Looking for device registration button...');
    let deviceAuthButton = null;
    let buttonAttempts = 0;
    const maxButtonAttempts = 10;
    
    while (buttonAttempts < maxButtonAttempts && !deviceAuthButton) {
      try {
        buttonAttempts++;
        console.log(`Attempt ${buttonAttempts} to find device auth button...`);
        
        // 페이지 상태 확인
        if (page.isClosed()) {
          console.log('Page was closed, cannot proceed');
          throw new Error('Page was closed during device registration');
        }
        
        // 더 긴 타임아웃으로 버튼 찾기
        deviceAuthButton = await page.waitForSelector('#device-auth-otp', { timeout: 10000 });
        console.log('Device auth button found successfully');
        break;
      } catch (e) {
        console.log(`Attempt ${buttonAttempts} failed:`, e);
        if (buttonAttempts >= maxButtonAttempts) {
          throw new Error(`Failed to find device auth button after ${maxButtonAttempts} attempts`);
        }
        // 더 긴 대기 시간
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    if (!deviceAuthButton) {
      throw new Error('Device auth button not found');
    }
    
    // 최종 등록 버튼 클릭
    await page.click('#device-auth-otp');
    console.log('Device registration complete.');
    
    // 디바이스 등록 완료 후 안정화 대기
    console.log('Waiting for device registration to complete...');
    
    // 페이지 상태 확인 (안전하게)
    let currentUrl = '';
    let attempts = 0;
    const maxAttempts = 10;
    
    while (attempts < maxAttempts) {
      try {
        attempts++;
        console.log(`Attempt ${attempts} to check page status...`);
        
        // 페이지가 닫혔는지 확인
        if (page.isClosed()) {
          console.log('Page was closed, cannot proceed');
          throw new Error('Page was closed during device registration');
        }
        
        currentUrl = await page.url();
        console.log(`Current URL after device registration (attempt ${attempts}):`, currentUrl);
        
        // 메인페이지로 리다이렉트되었는지 확인
        if (currentUrl.includes('sbisec.co.jp') && !currentUrl.includes('deviceAuthentication')) {
          console.log('Successfully redirected to main page');
          break;
        } else {
          console.log('Still on device authentication page, waiting...');
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
      } catch (e) {
        console.log(`Attempt ${attempts} failed:`, e);
        if (attempts >= maxAttempts) {
          console.log('Max attempts reached, continuing anyway...');
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

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
    
    // 안전한 페이지 이동
    let navigationSuccess = false;
    let navAttempts = 0;
    const maxNavAttempts = 5;
    
    while (navAttempts < maxNavAttempts && !navigationSuccess) {
      try {
        navAttempts++;
        console.log(`Attempt ${navAttempts} to navigate to dividend page...`);
        
        // 페이지 상태 확인
        if (page.isClosed()) {
          console.log('Page was closed, cannot proceed');
          throw new Error('Page was closed during dividend page navigation');
        }
        
        // 더 안전한 페이지 이동
        await page.goto(dividendUrl, { 
          waitUntil: 'domcontentloaded', 
          timeout: 60000 
        });
        console.log('Successfully navigated to dividend page');
        navigationSuccess = true;
        break;
        
      } catch (e) {
        console.log(`Attempt ${navAttempts} failed:`, e);
        if (navAttempts >= maxNavAttempts) {
          throw new Error(`Failed to navigate to dividend page after ${maxNavAttempts} attempts`);
        }
        
        // 더 긴 대기 시간
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
    
    if (!navigationSuccess) {
      throw new Error('Could not navigate to dividend page');
    }

    // 5. 최신 배당금 정보 추출 (CSV 다운로드 방식)
    console.log('Scraping dividend information via CSV download...');

    // CSV 다운로드 버튼을 즉시 찾고 클릭 (waitFor 없이)
    console.log('Looking for CSV download button...');
    
    let downloadButton = page.getByRole('button', { name: /CSVダウンロード/ });
    let buttonFound = false;
    
    try {
      // 버튼이 보이는지 즉시 확인 (타임아웃 없이)
      const isVisible = await downloadButton.isVisible();
      if (isVisible) {
        buttonFound = true;
        console.log('CSV download button found by role');
      }
    } catch {
      console.log('Role-based button not found, trying fallback selector...');
    }
    
    if (!buttonFound) {
      try {
        // 폴백 셀렉터로 시도
        downloadButton = page.locator('button.text-xs.link-light:has-text("CSVダウンロード")');
        const isVisible = await downloadButton.isVisible();
        if (isVisible) {
          buttonFound = true;
          console.log('CSV download button found by fallback selector');
        }
      } catch {
        console.log('Fallback selector also failed');
      }
    }
    
    if (!buttonFound) {
      throw new Error('CSV download button not found');
    }
    
    console.log('CSV download button found, proceeding with download...');

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
