import express from 'express';
import { scrapeDividend } from './lib/scraper.js';
import { sendLineMessage, type DividendData } from './lib/notification.js';
import dotenv from 'dotenv';

// 환경변수 파일 로드
dotenv.config();

// 환경변수 체크
const requiredEnvVars = [
  'LINE_CHANNEL_ACCESS_TOKEN',
  'MY_LINE_USER_ID',
  'SBI_ID',
  'SBI_PASSWORD',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REFRESH_TOKEN'
];

const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.warn('⚠️  다음 환경변수가 설정되지 않았습니다:');
  missingEnvVars.forEach(envVar => console.warn(`   - ${envVar}`));
  console.warn('   일부 기능이 제한될 수 있습니다.');
}

const app = express();
const PORT = process.env.PORT || 3001;

// JSON 파싱 미들웨어
app.use(express.json());

// 헬스체크 엔드포인트
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// 메인 배당금 스크래핑 웹훅
app.post('/api/dividend-webhook', async (req, res) => {
  try {
    console.log('Dividend webhook received');
    
    const { from, to } = req.body;
    console.log(`Scraping dividend for period: ${from} ~ ${to}`);

    const scrapeResult = await scrapeDividend({
      overrideDates: from && to ? { from, to } : undefined
    });

    if (scrapeResult) {
      console.log('Dividend information sent to LINE successfully');
      res.json({
        success: true,
        message: 'Dividend information processed and sent to LINE',
        data: scrapeResult
      });
    } else {
      const errorMessage = 'Failed to scrape dividend information';
      await sendLineMessage({
        type: 'error',
        message: errorMessage
      });
      res.status(500).json({
        success: false,
        error: errorMessage
      });
    }
  } catch (error) {
    console.error('Webhook error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    try {
      await sendLineMessage({
        type: 'error',
        message: `배당금 스크래핑 실패: ${errorMessage}`
      });
    } catch (lineError) {
      console.error('LINE notification failed:', lineError);
    }
    
    res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
});

// 테스트 알림 엔드포인트
app.post('/api/test-notification', async (req, res) => {
  try {
    console.log('Test notification received');
    
    const testDividendData: DividendData = {
      type: 'success',
      text: '테스트 알림입니다',
      source: 'GCP VM Test'
    };

    await sendLineMessage(testDividendData);
    console.log('Test notification sent to LINE successfully');

    res.json({
      success: true,
      message: 'Test notification sent to LINE',
      data: testDividendData
    });
  } catch (error) {
    console.error('Test notification error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// 서버 시작
app.listen(PORT, () => {
  console.log(`🚀 GCP VM 서버가 포트 ${PORT}에서 실행 중입니다`);
  console.log(`📊 배당금 웹훅: POST /api/dividend-webhook`);
  console.log(`🧪 테스트 알림: POST /api/test-notification`);
  console.log(`💚 헬스체크: GET /health`);
});

export default app;
