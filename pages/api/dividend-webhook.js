// /pages/api/dividend-webhook.js

import { Client } from '@line/bot-sdk';
import { scrapeDividend } from '../../lib/scraper';
import { sendLineMessage, sendErrorMessage } from '../../lib/notification';

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new Client(config);

export default async function handler(req, res) {
  // LINE의 웹훅인지, GAS의 트리거인지 판별
  const isLineWebhook = req.headers['x-line-signature'];

  if (req.method === 'POST') {
    // 비동기 처리를 위해 요청 즉시 200 OK 응답
    res.status(200).send('OK');

    try {
      // 1. 스크래핑 실행
      const dividendData = await scrapeDividend();

      // 2. LINE으로 성공 메시지 전송
      await sendLineMessage(dividendData);

    } catch (error) {
      console.error(error);
      // 3. 에러 발생 시 LINE으로 실패 메시지 전송
      await sendErrorMessage(error.message);
    }

  } else {
    res.setHeader('Allow', 'POST');
    res.status(405).end('Method Not Allowed');
  }
}
