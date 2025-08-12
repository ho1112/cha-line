// /Code.gs

// =================================================================
// 설정 (Configuration)
// =================================================================

// GCP VM에 배포된 웹훅 URL
const PRODUCTION_WEBHOOK_URL = 'http://34.127.69.45:3001/api/dividend-webhook';
const TEST_WEBHOOK_URL = 'http://34.127.69.45:3001/api/test-notification';
// GAS→서버(GCP VM) 인증용 시크릿
const SECRET = PropertiesService.getScriptProperties().getProperty('GAS_SHARED_SECRET') || '';


// 확인할 이메일 검색 조건
const SEARCH_QUERY = 'from:cs@sbisec.co.jp subject:配当金 -label:cha-line-done newer_than:1d';
const TEST_SEARCH_QUERY = 'subject:"cha-line-test" is:unread';

// 처리 완료 후 추가할 라벨 이름
const PROCESSED_LABEL = 'cha-line-done';

// JST yyyy/MM/dd 문자열로 변환
function toYmdJst(date) {
  return Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy/MM/dd');
}


// =================================================================
// 운영용 함수 (Production Functions)
// =================================================================

/**
 * 메인 함수: 지정된 시간에 트리거되어 실행됩니다.
 * 실제 배당금 메일을 찾아 운영 웹훅을 호출합니다.
 */
function main() {
  // 1. 실행 조건 확인 (평일, 업무시간)
  if (!isWeekdayJST() || !isWorkingHoursJST()) {
    console.log('주말 또는 업무시간이 아니므로 실행을 건너뜁니다.');
    return;
  }
  
  // 2. 신규 배당금 메일 검색
  const threads = GmailApp.search(SEARCH_QUERY);
  
  if (threads.length > 0) {
    console.log(`[운영] ${threads.length}개의 새로운 배당금 메일을 찾았습니다. 웹훅을 호출합니다.`);
    
    const response = UrlFetchApp.fetch(PRODUCTION_WEBHOOK_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-gas-secret': SECRET },
      payload: JSON.stringify({ source: 'Google Apps Script - Production' })
    });
    
    if (response.getResponseCode() == 200) {
      console.log('[운영] 웹훅 호출 성공. 이메일에 라벨을 추가합니다.');
      const label = getOrCreateLabel(PROCESSED_LABEL);
      for (const thread of threads) {
        thread.addLabel(label);
      }
    } else {
      console.error(`[운영] 웹훅 호출 실패: ${response.getContentText()}`);
    }
  } else {
    console.log('[운영] 새로운 배당금 메일이 없습니다.');
  }
}

/**
 * 지정된 이름의 라벨이 없으면 생성하고 반환하는 헬퍼 함수입니다.
 */
function getOrCreateLabel(labelName) {
  let label = GmailApp.getUserLabelByName(labelName);
  if (!label) {
    label = GmailApp.createLabel(labelName);
  }
  return label;
}

/**
 * 현재 시간이 일본 기준 평일인지 확인하는 헬퍼 함수입니다.
 */
function isWeekdayJST() {
  const now = new Date();
  const day = now.getDay(); // 0 (일요일) - 6 (토요일)
  return day > 0 && day < 6;
}

/**
 * 현재 시간이 일본 기준 업무시간(09:00 ~ 18:00)인지 확인하는 헬퍼 함수입니다.
 */
function isWorkingHoursJST() {
  const now = new Date();
  const hours = now.getHours();
  return hours >= 9 && hours < 18;
}


// =================================================================
// 테스트 전용 함수 (Test Function)
// =================================================================

/**
 * 테스트 함수: 하드코딩된 날짜로 풀 플로우를 실행합니다.
 * 테스트할 때마다 날짜를 수정해서 사용하세요.
 */
function testSearch() {
  // 테스트할 날짜 범위를 여기서 수정하세요
  const from = '2025/08/01';  // 시작 날짜
  const to = '2025/08/06';    // 종료 날짜
  
  console.log(`[테스트] 풀 플로우 실행(로그인→CSV→Flex) - 기간: ${from} ~ ${to}`);
  try {
    const response = UrlFetchApp.fetch(PRODUCTION_WEBHOOK_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-gas-secret': SECRET },
      payload: JSON.stringify({ source: 'Google Apps Script - Test (Full Flow)', from, to })
    });

    if (response.getResponseCode() == 200) {
      console.log(`[테스트] 웹훅 호출 성공: ${response.getContentText()}`);
      console.log('[테스트] GCP VM 서버 로그와 LINE 메시지를 확인하세요.');
    } else {
      console.error(`[테스트] 웹훅 호출 실패: ${response.getContentText()}`);
    }
  } catch (e) {
    console.error(`[테스트] 에러 발생: ${e.toString()}`);
  }
}

/**
 * 오늘만 테스트하는 함수
 */
function testToday() {
  const today = toYmdJst(new Date());
  console.log(`[테스트] 오늘만 테스트 - 기간: ${today}`);
  try {
    const response = UrlFetchApp.fetch(PRODUCTION_WEBHOOK_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-gas-secret': SECRET },
      payload: JSON.stringify({ source: 'Google Apps Script - Test (Today)', from: today, to: today })
    });

    if (response.getResponseCode() == 200) {
      console.log(`[테스트] 웹훅 호출 성공: ${response.getContentText()}`);
      console.log('[테스트] GCP VM 서버 로그와 LINE 메시지를 확인하세요.');
    } else {
      console.error(`[테스트] 웹훅 호출 실패: ${response.getContentText()}`);
    }
  } catch (e) {
    console.error(`[테스트] 에러 발생: ${e.toString()}`);
  }
}
