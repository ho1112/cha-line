// /pages/api/dividend-webhook.js

import { Client } from '@line/bot-sdk';
import { scrapeDividend } from '../../lib/scraper';
import { sendLineMessage, sendErrorMessage } from '../../lib/notification';

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new Client(config);

import { NextResponse } from 'next/server';

export async function POST(request) {
  // LINE의 웹훅인지, GAS의 트리거인지 판별
  const isLineWebhook = request.headers.get('x-line-signature');

  try {
    // 비동기 처리를 위해 즉시 응답을 반환하지 않고, 로직을 수행한 후 응답합니다.
    // Vercel의 서버리스 함수는 요청당 제한 시간이 있으므로, 
    // 스크래핑과 같이 오래 걸리는 작업은 백그라운드에서 처리하는 것이 좋습니다.
    // 하지만 현재 구조에서는 일단 동기적으로 처리합니다.

    // 1. 스크래핑 실행
    const dividendData = await scrapeDividend();

    // 2. LINE으로 성공 메시지 전송
    await sendLineMessage(dividendData);

    return NextResponse.json({ message: "Scraping and notification successful" });

  } catch (error) {
    console.error(error);
    // 3. 에러 발생 시 LINE으로 실패 메시지 전송
    await sendErrorMessage(error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
