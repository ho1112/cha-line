// /pages/api/test-scrape.js
// 목적: 이메일 트리거 없이, 스크래핑부터 LINE 알림까지 전체 과정을 수동으로 테스트합니다.
// 주의: 이 API는 실제 SBI 증권 사이트에 로그인하고 2FA를 시도합니다.
// 사용법: 브라우저에서 https://<YOUR_APP_URL>/api/test-scrape 으로 접속하면 즉시 실행됩니다.

import { scrapeDividend } from '../../lib/scraper';
import { sendLineMessage, sendErrorMessage } from '../../lib/notification';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  console.log('Executing manual scraping test...');
  
  // 비동기 처리를 위해 즉시 응답을 보내지 않고, 모든 과정이 끝날 때까지 기다립니다.
  try {
    // 1. 스크래핑 실행
    const dividendData = await scrapeDividend();

    if (dividendData) {
      // 2. 성공 시 LINE으로 메시지 전송
      await sendLineMessage(dividendData);
      console.log('Scraping test successful, notification sent.');
      res.status(200).json({
        status: 'success',
        message: '스크래핑에 성공했으며 LINE으로 알림을 보냈습니다.',
        data: dividendData,
      });
    } else {
      // scrapeDividend가 null을 반환한 경우 (예: 2FA 메일 없음)
      console.log('Scraping test finished, but no new data to send.');
      res.status(200).json({
        status: 'no_action',
        message: '스크래핑은 정상적으로 실행되었으나, 처리할 데이터(예: 2FA 이메일)가 없어 알림을 보내지 않았습니다.',
      });
    }

  } catch (error) {
    console.error('Scraping test failed:', error);
    // 3. 에러 발생 시 LINE으로 실패 메시지 전송
    await sendErrorMessage(`수동 스크래핑 테스트 중 에러 발생: ${error.message}`);
    
    res.status(500).json({
      status: 'error',
      message: '스크래핑 테스트 중 에러가 발생했으며, LINE으로 에러 알림을 보냈습니다.',
      error: error.message,
    });
  }
}
