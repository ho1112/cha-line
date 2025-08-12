// /lib/scraper.ts

import { chromium, Browser, BrowserContext, Page } from 'playwright';
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
  const loginUrl = 'https://site2.sbisec.co.jp/ETGate/';
  try {
    const isDebugMode = process.env.PWDEBUG === '1';
    if (isDebugMode) {
      const localChromePath = process.env.LOCAL_CHROME_PATH;
      if (localChromePath) {
        browser = await chromium.launch({ 
          headless: false, 
          executablePath: localChromePath
        });
      } else {
        try {
          browser = await chromium.launch({ 
            headless: false
          });
        } catch (e) {
          // macOS 기본 경로로 폴백
          browser = await chromium.launch({ 
            headless: false, 
            executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
          });
        }
      }
    } else {
      // Vercel 환경에서는 브라우저를 실행할 수 없으므로 에러 발생
      throw new Error('Browser automation is not supported in Vercel environment. Please use local development mode.');
    }

    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });

    const requiredSelectors = [
      'input[name="user_id"]',
      'input[name="user_password"]',
      'input[name="ACT_login"]',
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
  console.log('Gmail에서 인증 URL을 가져오는 중...');
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
    console.log('SBI 인증 이메일을 검색하는 중...');
    
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
    
    for (const query of searchQueries) {
      try {
        console.log(`검색 쿼리 시도: ${query}`);
        listResponse = await gmail.users.messages.list({
          userId: 'me',
          q: query,
          maxResults: 10, // 더 많은 결과 검색
        });
        
        if (listResponse.data.messages && listResponse.data.messages.length > 0) {
          console.log(`쿼리로 ${listResponse.data.messages.length}개의 이메일을 찾았습니다: ${query}`);
          
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
            console.log(`첫 번째 이메일 - 제목: ${subject}, 보낸사람: ${from}, 날짜: ${date}`);
          } catch (e) {
            console.log('첫 번째 이메일 메타데이터를 읽을 수 없습니다:', e);
          }
          
          break;
        }
      } catch (e) {
        console.log(`쿼리 실패: ${query}`, e);
        continue;
      }
    }
    
    if (!listResponse || !listResponse.data.messages || listResponse.data.messages.length === 0) {
      console.log('어떤 검색 쿼리로도 이메일을 찾을 수 없습니다.');
      return null;
    }

    if (!listResponse.data.messages || listResponse.data.messages.length === 0) {
      console.log('새로운 인증 URL 이메일을 찾을 수 없습니다.');
      return null;
    }

    // 5. 후보 메시지들에서 적절한 메시지 선택 (가장 최신 우선)
    const sinceMs = options?.sinceMs ?? 0;
    const lastSeen = options?.lastSeenMessageId ?? null;
    
    console.log(`이후 이메일을 찾는 중: ${new Date(sinceMs).toISOString()}`);
    
    let pickedId: string | null = null;
    let pickedPayload: any = null;
    
    for (const m of listResponse.data.messages) {
      const id = m.id!;
      if (lastSeen && id === lastSeen) {
        console.log(`이미 본 메시지를 건너뜁니다: ${id}`);
        continue;
      }
      
      const resp = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
      const payload = resp.data.payload;
      const internalDateStr: any = (resp.data as any).internalDate; // epoch ms (string)
      const internalDate = internalDateStr ? Number(internalDateStr) : 0;
      
      console.log(`메시지 ${id} 날짜: ${new Date(internalDate).toISOString()}, sinceMs: ${new Date(sinceMs).toISOString()}`);
      console.log(`시간 비교 상세: ${internalDate} >= ${sinceMs - (30 * 1000)} = ${internalDate >= (sinceMs - (30 * 1000))}`);
      console.log(`실제 숫자 값: ${internalDate} >= ${sinceMs - (30 * 1000)}`);
      console.log(`internalDate 타입: ${typeof internalDate}, sinceMs 타입: ${typeof sinceMs}`);
      
      // sinceMs 이후에 도착한 이메일만 허용 (30초 여유 허용)
      if (payload && internalDate >= (sinceMs - (30 * 1000))) {
        pickedId = id;
        pickedPayload = payload;
        console.log(`선택된 메시지 ${id}, 날짜: ${new Date(internalDate).toISOString()}`);
        break;
      }
    }
    
    if (!pickedId || !pickedPayload) {
      console.log('시간 창 내에서 일치하는 인증 URL 이메일을 찾을 수 없습니다.');
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
    console.log(`가져온 인증 URL: ${authUrl}`);
    return { url: authUrl, messageId };

  } catch (error: any) {
    console.error('Gmail에서 인증 URL을 가져오는데 실패했습니다:', error);
    if (error.response) {
      console.error('API 오류 세부사항:', error.response.data.error);
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
  
  console.log(`Gmail에서 인증 URL을 기다리는 중 (타임아웃: ${timeoutMs}ms, 폴링: ${pollMs}ms)`);
  
  while (Date.now() - start < timeoutMs) {
    attemptCount++;
    console.log(`Gmail 검색 시도 ${attemptCount}...`);
    
    const found = await getAuthUrlFromGmail({ sinceMs, lastSeenMessageId: lastSeen }).catch(() => null);
    if (found) {
      // 찾은 이메일의 ID를 lastSeen으로 업데이트
      lastSeen = found.messageId;
      return found;
    }
    
    const elapsed = Date.now() - start;
    console.log(`아직 인증 URL을 찾지 못했습니다 (경과: ${elapsed}ms, 남은 시간: ${timeoutMs - elapsed}ms)`);
    
    await new Promise(res => setTimeout(res, pollMs));
  }
  throw new Error(`Gmail에서 인증 URL을 기다리는 시간이 초과되었습니다 (>${timeoutMs}ms)`);
}

interface DividendResult {
  text: string;
  source: string;
}

export async function scrapeDividend(options: { debugAuthOnly?: boolean; overrideDates?: { from?: string; to?: string } } = {}): Promise<DividendResult | null> {
  let browser: any = null;
  console.log('배당금 스크래핑 프로세스를 시작합니다...');

  try {
    const isDebugMode = process.env.PWDEBUG === '1';
    
    if (isDebugMode) {
      console.log('로컬 디버그 모드로 실행 중입니다. 시스템 Chrome을 시작합니다...');
      const localChromePath = process.env.LOCAL_CHROME_PATH;
      if (localChromePath) {
        browser = await chromium.launch({ headless: false, executablePath: localChromePath });
      } else {
        try {
          browser = await chromium.launch({ headless: false });
        } catch (e) {
          browser = await chromium.launch({ headless: false, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
        }
      }
    } else {
      if (process.env.NODE_ENV === 'production') {
        // GCP VM 프로덕션 모드로 실행 중입니다. Playwright를 시작합니다...
        console.log('GCP VM 프로덕션 모드로 실행 중입니다. Playwright를 시작합니다...');
        
        browser = await chromium.launch({
          headless: true,  // GCP VM에서는 헤드리스 모드로 실행
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
          ]
        });
      } else {
        console.log('로컬 개발 모드로 실행 중입니다. Playwright를 시작합니다...');
        browser = await chromium.launch({
          headless: false,  // 로컬에서도 헤드리스 모드로 실행
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote', '--single-process', '--disable-gpu']
        });
      }
    }

    if (!browser) {
      throw new Error('Failed to acquire a browser instance');
    }

    // 컨텍스트 생성
    console.log('새 브라우저 컨텍스트를 생성합니다...');
    const context = await browser.newContext({ 
      acceptDownloads: true,
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    
    // 페이지별 타임아웃 설정 (GCP 미국 리전 고려)
    context.setDefaultTimeout(120000);  // 120초(2분)
    context.setDefaultNavigationTimeout(120000);  // 120초(2분)
    console.log('브라우저 컨텍스트가 성공적으로 생성되었습니다');
    const page = await context.newPage();

    // 1. SBI 증권 로그인 페이지로 이동
    console.log('SBI 증권 로그인 페이지로 이동합니다...');
    await page.goto('https://site2.sbisec.co.jp/ETGate/', {
      timeout: 120000,  // 120초(2분)로 증가
      waitUntil: 'domcontentloaded'  // 더 빠른 로딩 조건
    });

    // 로그인 페이지 진입 완료

    // 2. 아이디와 비밀번호 입력
    await page.fill('input[name="user_id"]', process.env.SBI_ID!);
    await page.fill('input[name="user_password"]', process.env.SBI_PASSWORD!);

    // 로그인 버튼 클릭과 페이지 이동을 함께 기다립니다.
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
        page.click('input[name="ACT_login"]'),
    ]);
    console.log('ID/비밀번호로 로그인했습니다.');

    // 3. 현재 페이지 상태 확인 (이미 디바이스 인증 페이지에 있음)
    console.log('현재 페이지 상태를 확인합니다...');
    
    // 페이지 안정화 대기
    await page.waitForLoadState('domcontentloaded');
    console.log('로그인 후 페이지가 안정화되었습니다');
    
    // 안전하게 페이지 정보 읽기
    try {
      const currentUrl = await page.url();
      console.log('현재 페이지 URL:', currentUrl);
      
      const currentTitle = await page.title();
      console.log('현재 페이지 제목:', currentTitle);
    } catch (e) {
      console.log('페이지 정보를 읽을 수 없지만 계속 진행합니다...', e);
    }
    
    // 4. 새로운 디바이스 인증 로직 (2025/8/9 이후 사양)
    console.log('새로운 디바이스 인증 플로우를 시작합니다...');

    // 현재 페이지 상태 확인 및 디버깅 (안전하게)
    try {
      const currentUrl = await page.url();
      console.log('현재 페이지 URL:', currentUrl);
      
      const currentTitle = await page.title();
      console.log('현재 페이지 제목:', currentTitle);
    } catch (e) {
      console.log('페이지 정보를 읽을 수 없지만 계속 진행합니다...', e);
    }
    
    // 페이지 로딩 완료 대기 (networkidle 대신 더 간단한 방법 사용)
    await page.waitForLoadState('domcontentloaded');
    
    // 페이지 안정화 대기 (동적 콘텐츠 로딩을 위해)
    await page.waitForLoadState('domcontentloaded');  // DOM 로딩 완료까지만 대기
    await page.waitForTimeout(8000);  // 추가 안정화 시간 (8초로 증가)
    console.log('페이지가 안정화되었습니다. 이메일 버튼을 찾습니다...');

    // "Eメールを送信する" 버튼 찾기 시도 (강화된 fallback 로직)
    let emailButton = null;
    let buttonFound = false;
    
    // 1차: name 속성 기반 (가장 안정적)
    try {
      emailButton = page.locator('button[name="ACT_deviceotpcall"]');
      await emailButton.waitFor({ state: 'visible', timeout: 15000 });  // 15초로 증가
      buttonFound = true;
      console.log('name 속성으로 이메일 버튼을 찾았습니다');
    } catch (e) {
      console.log('name 속성 기반 버튼을 찾을 수 없습니다. 대안 선택자를 시도합니다...');
    }
    
    // 2차: CSS 클래스 기반
    if (!buttonFound) {
      try {
        emailButton = page.locator('button.seeds-button-lg');
        await emailButton.waitFor({ state: 'visible', timeout: 15000 });  // 15초로 증가
        buttonFound = true;
        console.log('CSS 클래스로 이메일 버튼을 찾았습니다');
      } catch (e) {
        console.log('CSS 클래스 기반 검색도 실패했습니다');
      }
    }
    
    // 3차: 텍스트 기반 (타임아웃 증가)
    if (!buttonFound) {
      try {
        emailButton = page.locator('button:has-text("Eメールを送信する")');
        await emailButton.waitFor({ state: 'visible', timeout: 15000 });  // 15초로 증가
        buttonFound = true;
        console.log('텍스트로 이메일 버튼을 찾았습니다');
      } catch (e) {
        console.log('텍스트 기반 버튼을 찾을 수 없습니다. 대안 선택자를 시도합니다...');
      }
    }
    
    // 2차: aria-label 기반
    if (!buttonFound) {
      try {
        emailButton = page.locator('[aria-label*="メール"], [aria-label*="email"]');
        await emailButton.waitFor({ state: 'visible', timeout: 15000 });  // 15초로 증가
        buttonFound = true;
        console.log('aria-label으로 이메일 버튼을 찾았습니다');
      } catch (e2) {
        console.log('aria-label 기반 검색도 실패했습니다');
      }
    }
    
    // 3차: 일반적인 버튼 선택자
    if (!buttonFound) {
      try {
        emailButton = page.locator('button').filter({ hasText: /メール|email/i });
        await emailButton.waitFor({ state: 'visible', timeout: 15000 });  // 15초로 증가
        buttonFound = true;
        console.log('일반 선택자로 이메일 버튼을 찾았습니다');
      } catch (e3) {
        console.log('일반 선택자 검색도 실패했습니다');
      }
    }
    
    // 4차: 더 넓은 범위 검색
    if (!buttonFound) {
      try {
        emailButton = page.locator('a:has-text("メール"), button:has-text("メール"), [role="button"]:has-text("メール")');
        await emailButton.waitFor({ state: 'visible', timeout: 15000 });  // 15초로 증가
        buttonFound = true;
        console.log('넓은 범위 검색으로 이메일 버튼을 찾았습니다');
      } catch (e4) {
        console.log('넓은 범위 검색도 실패했습니다');
      }
    }
    
    // 5차: 페이지 내용 분석으로 디버깅
    if (!buttonFound) {
      console.log('모든 이메일 버튼 찾기 방법이 실패했습니다. 페이지 내용을 분석합니다...');
      try {
        const pageContent = await page.content();
        const emailButtonMatches = pageContent.match(/メール[^<]*/g);
        if (emailButtonMatches) {
          console.log('페이지에서 메일 관련 텍스트 발견:', emailButtonMatches.slice(0, 5));
        }
        
        // 모든 버튼과 링크 찾기
        const allButtons = await page.locator('button, a, [role="button"]').all();
        console.log(`페이지에 총 ${allButtons.length}개의 버튼/링크가 있습니다`);
        
        for (let i = 0; i < Math.min(allButtons.length, 10); i++) {
          try {
            const text = await allButtons[i].textContent();
            if (text && text.includes('メール')) {
              console.log(`메일 관련 요소 발견 (${i}번째):`, text.trim());
            }
          } catch (e) {
            // 개별 요소 텍스트 읽기 실패는 무시
          }
        }
      } catch (e) {
        console.log('페이지 내용 분석 중 오류:', e);
      }
      
      throw new Error('페이지에서 이메일 버튼을 찾을 수 없습니다');
    }

    // 버튼 클릭
    await emailButton.click();
    console.log('이메일 전송 버튼을 클릭했습니다.');

    // 이메일에서 인증 URL을 기다림 (폴링 + 타임아웃)
    // 트리거 시각 이후에 도착한 메일만 대상
    const triggerMs = Date.now();
    const found = await waitForAuthUrlFromGmail({ sinceMs: triggerMs });
    const authUrl = found.url;

    // 4. 새 탭에서 인증 URL 열고 코드 입력
    console.log(`새 탭에서 인증 URL을 엽니다: ${authUrl}`);
    
    // 새 페이지 생성
    let authPage = null;
    let authTabAttempts = 0;
    
    while (authTabAttempts < 10 && !authPage) {
      try {
        authTabAttempts++;
        console.log(`인증 탭 생성 시도 ${authTabAttempts}...`);
        
        // 새 페이지 생성
        authPage = await context.newPage();
        console.log('인증 탭이 성공적으로 생성되었습니다');
        
        // 인증 URL로 이동
        console.log('인증 URL로 이동합니다...');
        await authPage.goto(authUrl, { 
          waitUntil: 'domcontentloaded', 
          timeout: 120000  // 120초(2분)로 증가
        });
        console.log('인증 URL로 성공적으로 이동했습니다');
        break;
        
      } catch (e) {
        console.log(`시도 ${authTabAttempts} 실패:`, e);
        
        // 실패한 페이지 정리
        if (authPage) {
          try {
            await authPage.close();
          } catch (closeError) {
            console.log('실패한 인증 페이지를 닫을 수 없습니다:', closeError);
          }
          authPage = null;
        }
        
        if (authTabAttempts >= 10) {
          throw new Error(`10번 시도 후에도 인증 탭을 생성하고 이동할 수 없습니다`);
        }
        
        // 더 긴 대기 시간
        console.log(`재시도 전 ${authTabAttempts * 1000}ms 대기...`);
        await new Promise(resolve => setTimeout(resolve, authTabAttempts * 1000));
      }
    }
    
    if (!authPage) {
      throw new Error('인증 탭을 생성할 수 없습니다');
    }

    // 인증 페이지 도착

    // ★★★ 중요: 아래 선택자는 실제 페이지와 다를 수 있습니다. ★★★
    // 코드는 40초마다 변경되므로, 입력 직전에 최신 값을 다시 읽어온다
    console.log('메인 페이지에서 인증 코드를 읽습니다...');
    
    let codeElement = null;
    let codeAttempts = 0;
    
    while (codeAttempts < 10 && !codeElement) {
      try {
        codeAttempts++;
        console.log(`코드 표시 요소 찾기 시도 ${codeAttempts}...`);
        
        // 메인 페이지 상태 확인
        try {
          await page.url(); // 페이지가 살아있는지 테스트
        } catch (pageError) {
          console.log('메인 페이지 테스트 실패:', pageError);
          throw new Error('메인 페이지가 닫혔습니다');
        }
        
        // 코드 요소 찾기
        codeElement = await page.waitForSelector('#code-display', { timeout: 30000 });  // 30초로 증가
        console.log('코드 표시 요소를 성공적으로 찾았습니다');
        break;
      } catch (e) {
        console.log(`시도 ${codeAttempts} 실패:`, e);
        if (codeAttempts >= 10) {
          throw new Error(`10번 시도 후에도 코드 표시 요소를 찾을 수 없습니다`);
        }
        // 점진적으로 대기 시간 증가
        const waitTime = Math.min(codeAttempts * 1000, 3000);
        console.log(`재시도 전 ${waitTime}ms 대기...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    
    if (!codeElement) {
      throw new Error('코드 표시 요소를 찾을 수 없습니다');
    }
    
    // 코드 읽기
    const latestCode = (await codeElement.textContent())?.trim();
    if (!latestCode) throw new Error('웹 페이지에서 최신 인증 코드를 읽을 수 없습니다.');
    console.log('인증 코드를 성공적으로 읽었습니다:', latestCode);
    
    // 인증 코드 입력 필드가 활성화될 때까지 기다리기 (더 안전하게)
    console.log('인증 코드 입력 필드가 활성화될 때까지 기다립니다...');
    
    let inputField = null;
    let inputAttempts = 0;
    
    while (inputAttempts < 10 && !inputField) {
      try {
        inputAttempts++;
        console.log(`활성화된 입력 필드 찾기 시도 ${inputAttempts}...`);
        
        // 인증 페이지 상태 확인
        try {
          await authPage.url(); // 페이지가 살아있는지 테스트
        } catch (pageError) {
          console.log('인증 페이지 테스트 실패:', pageError);
          throw new Error('인증 페이지가 닫혔습니다');
        }
        
        // 입력 필드 찾기
        inputField = await authPage.waitForSelector('input[name="verifyCode"]:not([disabled])', { timeout: 30000 });  // 30초로 증가
        console.log('인증 코드 입력 필드가 이제 활성화되었습니다');
        break;
      } catch (e) {
        console.log(`시도 ${inputAttempts} 실패:`, e);
        if (inputAttempts >= 10) {
          throw new Error(`10번 시도 후에도 활성화된 입력 필드를 찾을 수 없습니다`);
        }
        // 점진적으로 대기 시간 증가
        const waitTime = Math.min(inputAttempts * 1000, 3000);
        console.log(`재시도 전 ${waitTime}ms 대기...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    
    if (!inputField) {
      throw new Error('활성화된 입력 필드를 찾을 수 없습니다');
    }
    
    // 인증 코드 입력 및 제출
    try {
      await authPage.fill('input[name="verifyCode"]', latestCode);
      console.log('인증 코드가 성공적으로 입력되었습니다');
      
      await authPage.click('button:has-text("認証する")');
      console.log('인증 페이지에서 인증 코드를 제출했습니다.');
    } catch (submitError) {
      console.log('인증 코드 제출 실패, JavaScript 방법을 시도합니다:', submitError);
      // 대안 방법: JavaScript로 직접 입력 및 제출
      await authPage.evaluate((code: string) => {
        const input = document.querySelector('input[name="verifyCode"]') as HTMLInputElement;
        const button = document.querySelector('button:has-text("認証する")') as HTMLButtonElement;
        if (input) input.value = code;
        if (button) button.click();
      }, latestCode);
      console.log('JavaScript로 인증 코드를 제출했습니다');
    }
    
    // 인증 완료 후 탭2를 닫고 탭1로 돌아가기
    console.log('인증 코드가 제출되었습니다. 인증 탭을 닫고 메인 탭으로 돌아갑니다...');
    
    try {
      await authPage.close();
      console.log('인증 탭을 성공적으로 닫았습니다');
    } catch (closeError) {
      console.log('인증 탭 닫기 실패, 계속 진행합니다:', closeError);
    }

    // 5. 원래 페이지로 돌아와서 최종 등록
    console.log('원래 페이지로 돌아와서 최종 등록을 진행합니다.');
    
    // 메인 페이지 안정화 대기
    console.log('메인 페이지 안정화를 기다립니다...');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(8000); // 8초로 증가 (GCP 환경 고려)
    
    console.log('메인 페이지가 안정화되었습니다. 디바이스 등록을 진행합니다...');
    
    // 체크박스 체크 → 버튼 활성화 → 등록 버튼 클릭
    console.log('디바이스 체크박스를 찾습니다...');
    
    // 체크박스 찾기
    let deviceCheckbox = null;
    let checkboxAttempts = 0;
    
    while (checkboxAttempts < 15 && !deviceCheckbox) {
      try {
        checkboxAttempts++;
        console.log(`디바이스 체크박스 찾기 시도 ${checkboxAttempts}...`);
        
        // 페이지 상태 확인 (타입 안전하게)
        try {
          await page.url(); // 페이지가 살아있는지 테스트
        } catch (pageError) {
          console.log('페이지 테스트 실패, 진행할 수 없습니다:', pageError);
          throw new Error('디바이스 등록 중에 페이지가 닫혔습니다');
        }
        
        // 체크박스 찾기
        deviceCheckbox = await page.waitForSelector('#device-checkbox', { timeout: 30000 });  // 30초로 증가
        console.log('디바이스 체크박스를 성공적으로 찾았습니다');
        break;
      } catch (e) {
        console.log(`시도 ${checkboxAttempts} 실패:`, e);
        if (checkboxAttempts >= 15) {
          throw new Error(`15번 시도 후에도 디바이스 체크박스를 찾을 수 없습니다`);
        }
        // 점진적으로 대기 시간 증가
        const waitTime = Math.min(checkboxAttempts * 1000, 5000);
        console.log(`재시도 전 ${waitTime}ms 대기...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    
    if (!deviceCheckbox) {
      throw new Error('디바이스 체크박스를 찾을 수 없습니다');
    }
    
    // 체크박스 체크 (안전하게)
    try {
      if (!(await page.isChecked('#device-checkbox'))) {
        await page.check('#device-checkbox');
        console.log('디바이스 체크박스가 성공적으로 체크되었습니다');
      } else {
        console.log('디바이스 체크박스가 이미 체크되어 있습니다');
      }
    } catch (checkError) {
      console.log('체크박스 체크 실패, 대안 방법을 시도합니다:', checkError);
      // 대안 방법: JavaScript로 직접 체크
      await page.evaluate(() => {
        const checkbox = document.getElementById('device-checkbox') as HTMLInputElement;
        if (checkbox && !checkbox.checked) {
          checkbox.checked = true;
          checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      console.log('JavaScript로 디바이스 체크박스를 체크했습니다');
    }
    
    // 체크박스 체크 후 버튼 활성화 대기
    console.log('체크박스 체크 후 버튼이 활성화될 때까지 기다립니다...');
    await page.waitForTimeout(10000); // 10초로 증가 (GCP 환경 고려)

    // 디바이스 등록 버튼을 안전하게 찾기
    console.log('디바이스 등록 버튼을 찾습니다...');
    let deviceAuthButton = null;
    let buttonAttempts = 0;
    
    while (buttonAttempts < 10 && !deviceAuthButton) {
      try {
        buttonAttempts++;
        console.log(`디바이스 인증 버튼 찾기 시도 ${buttonAttempts}...`);
        
        // 페이지 상태 확인
        if (page.isClosed()) {
          console.log('페이지가 닫혔습니다. 진행할 수 없습니다');
          throw new Error('디바이스 등록 중에 페이지가 닫혔습니다');
        }
        
        // 더 긴 타임아웃으로 버튼 찾기
        deviceAuthButton = await page.waitForSelector('#device-auth-otp', { timeout: 30000 });  // 30초로 증가
        console.log('디바이스 인증 버튼을 성공적으로 찾았습니다');
        break;
      } catch (e) {
        console.log(`시도 ${buttonAttempts} 실패:`, e);
        if (buttonAttempts >= 10) {
          throw new Error(`10번 시도 후에도 디바이스 인증 버튼을 찾을 수 없습니다`);
        }
        // 더 긴 대기 시간
        await new Promise(resolve => setTimeout(resolve, 5000));  // 5초로 증가
      }
    }
    
    if (!deviceAuthButton) {
      throw new Error('디바이스 인증 버튼을 찾을 수 없습니다');
    }
    
    // 최종 등록 버튼 클릭
    await page.click('#device-auth-otp');
    console.log('디바이스 등록이 완료되었습니다.');
    
    // 디바이스 등록 완료 후 안정화 대기
    console.log('디바이스 등록 완료를 기다립니다...');
    
    // 메인 페이지로 리다이렉트될 때까지 대기
    await page.waitForLoadState('domcontentloaded');
    
    // 로그인 완료 확인 전에 페이지 상태 디버깅
    console.log('로그인 완료 확인 전에 페이지 상태를 체크합니다...');
    console.log('현재 페이지 URL:', await page.url());
    console.log('현재 페이지 제목:', await page.title());
    
    // 페이지 내용 확인 (HTML 일부만 출력)
    const loginPageContent = await page.content();
    const contentPreview = loginPageContent.substring(0, 2000); // 처음 2000자만
    console.log('페이지 내용 미리보기:', contentPreview);
    
    // assets-buttons 요소 존재 여부 확인
    if (loginPageContent.includes('assets-buttons')) {
      console.log('assets-buttons 요소가 페이지에 존재합니다');
    } else {
      console.log('assets-buttons 요소가 페이지에 존재하지 않습니다');
      
      // 대신 다른 로그인 완료 표시 요소 확인
      if (loginPageContent.includes('My資産')) {
        console.log('My資産 링크가 발견되었습니다. 로그인 완료로 판단합니다.');
      } else if (loginPageContent.includes('ポートフォリオ')) {
        console.log('ポートフォリオ 링크가 발견되었습니다. 로그인 완료로 판단합니다.');
      } else {
        console.log('로그인 완료 표시 요소를 찾을 수 없습니다.');
      }
    }
    // 로그인 완료 확인 (assets-buttons 요소가 나타날 때까지)
    console.log('로그인 완료를 확인합니다...');
    try {
      await page.waitForSelector('.seeds-flex.assets-buttons', { timeout: 30000 });
      console.log('로그인이 완료되었습니다. 메인 페이지에 정상 접근 가능합니다.');
    } catch (e) {
      console.log('로그인 완료 확인 실패:', e);
      throw new Error('디바이스 등록 후 로그인 완료를 확인할 수 없습니다');
    }

    if (options.debugAuthOnly) {
      console.log('[DEBUG] 인증 전용 모드가 활성화되었습니다. CSV 다운로드를 건너뜁니다.');
      return {
        text: '장치 인증까지 완료(디버그 모드).',
        source: 'SBI Securities (AuthOnly)'
      };
    }

    // 4. 배당금 이력 페이지로 이동 (항상 날짜 파라미터만 사용)
    console.log('배당금 이력용 동적 URL을 생성합니다...');

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

    console.log(`다음으로 이동합니다: ${dividendUrl}`);
    
    // 안전한 페이지 이동
    let navigationSuccess = false;
    let navAttempts = 0;
    
    while (navAttempts < 5 && !navigationSuccess) {
      try {
        navAttempts++;
        console.log(`배당금 페이지로 이동 시도 ${navAttempts}...`);
        
        // 페이지 상태 확인
        if (page.isClosed()) {
          console.log('페이지가 닫혔습니다. 진행할 수 없습니다');
          throw new Error('배당금 페이지 이동 중에 페이지가 닫혔습니다');
        }
        
        // 더 안전한 페이지 이동
        await page.goto(dividendUrl, { 
          waitUntil: 'domcontentloaded', 
          timeout: 120000  // 120초(2분)로 증가
        });
        console.log('배당금 페이지로 성공적으로 이동했습니다');
        
        // 배당금 페이지로 이동 후 URL 확인
        let currentUrl = page.url();
        if (!currentUrl.includes('dividends')) {
          console.log('배당금 페이지로 이동하지 못했습니다. 현재 URL:', currentUrl);
          console.log('다시 시도합니다...');
          
          // 다시 배당금 페이지로 이동
          await page.goto(dividendUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
          currentUrl = page.url();
          
          if (!currentUrl.includes('dividends')) {
            throw new Error('배당금 페이지로 이동에 실패했습니다. 현재 URL: ' + currentUrl);
          }
          console.log('재시도 후 올바른 배당금 페이지에 도착했습니다');
        }
        
        navigationSuccess = true;
        break;
        
      } catch (e) {
        console.log(`시도 ${navAttempts} 실패:`, e);
        if (navAttempts >= 5) {
          throw new Error(`5번 시도 후에도 배당금 페이지로 이동할 수 없습니다`);
        }
        
        // 더 긴 대기 시간
        await new Promise(resolve => setTimeout(resolve, 5000));  // 5초로 증가
      }
    }
    
    if (!navigationSuccess) {
      throw new Error('배당금 페이지로 이동할 수 없습니다');
    }

    // 5. 최신 배당금 정보 추출 (CSV 다운로드 방식)
    console.log('CSV 다운로드 방식으로 배당금 정보를 스크래핑합니다...');

    // CSV 다운로드 버튼을 찾기 전에 배당금 이력 존재 여부 확인
    console.log('배당금 이력 존재 여부를 확인합니다...');
    try {
      const noHistoryMessage = await page.locator('p.table-message:has-text("指定された条件での履歴は見つかりませんでした")').isVisible();
      if (noHistoryMessage) {
        console.log('배당금 이력이 없습니다. CSV 버튼이 표시되지 않습니다.');
        return {
          text: '지정된 기간에 배당금 이력이 없습니다.',
          source: 'SBI Securities (No Data)'
        };
      } else {
        console.log('배당금 이력이 있습니다. CSV 버튼을 찾습니다...');
      }
    } catch (e) {
      console.log('배당금 이력 확인 중 오류:', e);
      console.log('이력 확인에 실패했지만 CSV 버튼 찾기를 계속합니다...');
    }

    // CSV 다운로드 버튼을 찾습니다
    console.log('CSV 다운로드 버튼을 찾습니다...');
    
    // 페이지 상태 디버깅
    console.log('현재 페이지 URL:', await page.url());
    console.log('현재 페이지 제목:', await page.title());
    
    // 페이지 내용 확인
    const pageContent = await page.content();
    if (pageContent.includes('dividends-summary')) {
      console.log('dividends-summary 요소가 페이지에 존재합니다');
    } else {
      console.log('dividends-summary 요소가 페이지에 존재하지 않습니다');
    }
    
    if (pageContent.includes('CSVダウンロード')) {
      console.log('CSV 다운로드 텍스트가 페이지에 존재합니다');
    } else {
      console.log('CSV 다운로드 텍스트가 페이지에 존재하지 않습니다');
    }
    
    // 배당금 데이터 테이블이 로딩되었는지 확인
    await page.waitForSelector('#dividends-summary .table', { timeout: 30000 });
    await page.waitForTimeout(2000); // 추가 안정화
    
    const downloadButton = page.locator('button.text-xs.link-light:has-text("CSV")');
    await downloadButton.waitFor({ state: 'visible', timeout: 30000 });
    console.log('CSV 다운로드 버튼을 찾았습니다. 다운로드를 진행합니다...');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      downloadButton.click(),
    ]);

    // 다운로드된 파일의 임시 경로를 가져옵니다.
    const tempFilePath = await download.path();
    if (!tempFilePath) {
        throw new Error('다운로드용 임시 파일 경로를 가져올 수 없습니다.');
    }
    console.log(`파일이 임시 경로에 다운로드되었습니다: ${tempFilePath}`);

    // CSV 파일을 Shift_JIS 인코딩으로 읽고 파싱합니다.
    const fileBuffer = fs.readFileSync(tempFilePath);
    const csvData = iconv.decode(fileBuffer, 'Shift_JIS');
    const parsed = parseDividendCsvText(csvData);
    const records = parsed.items;

    // 임시 파일을 삭제합니다.
    fs.unlinkSync(tempFilePath);
    console.log('임시 파일이 삭제되었습니다.');

    if (records.length === 0) {
        console.log('CSV 파일이 비어있습니다. 새로운 배당금이 없습니다.');
        return {
            text: '금일 신규 배당금 내역이 없습니다.',
            source: 'SBI Securities (CSV)'
        };
    }

    // 파싱된 데이터를 기반으로 알림 메시지를 생성합니다.
    console.log(`스크래핑이 완료되었습니다. ${records.length}개의 항목을 찾았습니다.`);

    // 운영도 Flex로 전송
    const flex = buildDividendFlex(parsed);
    await sendFlexMessage(flex, '배당 알림');
    return {
      text: 'Flex 메시지가 전송되었습니다',
      source: 'SBI Securities (CSV)'
    };

  } catch (error) {
    console.error('스크래핑 실패:', error);
    throw new Error('배당금 정보 스크래핑에 실패했습니다.');
  } finally {
    if (browser) {
      await browser.close();
      console.log('브라우저가 닫혔습니다.');
    }
  }
}
