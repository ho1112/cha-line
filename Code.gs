// /Code.gs

// Vercel에 배포된 웹훅 URL
const WEBHOOK_URL = 'cha-line.vercel.app';

// --- 운영용 설정 ---
// 확인할 이메일 검색 조건 (실제 운영용) -> 동작 후에는 label설정하므로 label이 없고&&1day 이내의 메일만 대상
const SEARCH_QUERY = 'from:cs@sbisec.co.jp subject:配当金 -label:cha-line-done newer_than:1d';
// 처리 완료 후 추가할 라벨
const PROCESSED_LABEL = 'cha-line-done';

// --- 테스트용 설정 ---
// testSearch 함수에서만 사용할 검색 조건
const TEST_SEARCH_QUERY = 'subject:"cha-line-test" is:unread';

/**
 * 메인 함수: 지정된 시간에 트리거되어 실행됩니다.
 */
function main() {
  // 1. 실행 조건 확인 (평일, 업무시간)
  if (!isWeekdayJST() || !isWorkingHoursJST()) {
    console.log('주말 또는 업무시간이 아니므로 실행을 건너뜁니다.');
    return;
  }
  
  // 2. 신규 배당금 메일 검색 (운영용 SEARCH_QUERY 사용)
  const threads = GmailApp.search(SEARCH_QUERY);
  
  if (threads.length > 0) {
    console.log(`[운영] ${threads.length}개의 새로운 배당금 메일을 찾았습니다. 웹훅을 호출합니다.`);
    
    const response = UrlFetchApp.fetch(WEBHOOK_URL, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ source: 'Google Apps Script' })
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
 * 지정된 이름의 라벨이 없으면 생성하고 반환합니다.
 */
function getOrCreateLabel(labelName) {
  let label = GmailApp.getUserLabelByName(labelName);
  if (!label) {
    label = GmailApp.createLabel(labelName);
  }
  return label;
}

/**
 * 현재 시간이 일본 기준 평일인지 확인합니다.
 */
function isWeekdayJST() {
  const now = new Date();
  const day = now.getDay();
  return day > 0 && day < 6;
}

/**
 * 현재 시간이 일본 기준 업무시간(09:00 ~ 18:00)인지 확인합니다.
 */
function isWorkingHoursJST() {
  const now = new Date();
  const hours = now.getHours();
  return hours >= 9 && hours < 18;
}


// --- 이하 테스트 전용 함수 ---

/**
 * 테스트 함수: TEST_SEARCH_QUERY 조건으로 메일을 검색하고 결과를 로그에 출력합니다.
 * 웹훅 호출이나 라벨링은 수행하지 않습니다.
 */
function testSearch() {
  console.log(`[테스트] 시작. 검색 조건: "${TEST_SEARCH_QUERY}"`);
  
  try {
    // 테스트용 TEST_SEARCH_QUERY 사용
    const threads = GmailApp.search(TEST_SEARCH_QUERY);
    
    if (threads.length > 0) {
      console.log(`[테스트] 총 ${threads.length}개의 메일 스레드를 찾았습니다.`);
      threads.forEach(function(thread, i) {
        const message = thread.getMessages()[0];
        console.log(`--- 메일 ${i + 1} ---`);
        console.log(`제목: ${message.getSubject()}`);
        console.log(`날짜: ${message.getDate()}`);
        console.log(`보낸사람: ${message.getFrom()}`);
        console.log('-------------------');
      });
    } else {
      console.log('[테스트] 조건에 맞는 메일을 찾지 못했습니다. TEST_SEARCH_QUERY를 확인해보세요.');
    }
  } catch (e) {
    console.error(`[테스트] 에러 발생: ${e.toString()}`);
  }
}