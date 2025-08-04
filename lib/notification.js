// /lib/notification.js

import { Client } from '@line/bot-sdk';

const lineClient = new Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
});

export async function sendLineMessage(dividendData) {
  const userId = process.env.MY_LINE_USER_ID;
  if (!userId) {
    console.error('MY_LINE_USER_ID is not set.');
    return;
  }

  // 고정된 템플릿 메시지 사용
  const messageText = `새로운 배당금이 입금되었습니다!\n\n[상세 내역]\n${dividendData.text}`;

  const message = {
    type: 'text',
    text: messageText,
  };

  try {
    await lineClient.pushMessage(userId, message);
    console.log('Successfully sent dividend notification to LINE.');
  } catch (error) {
    console.error('Failed to send LINE message:', error.originalError.response.data);
    throw new Error('Failed to send LINE message.');
  }
}

export async function sendErrorMessage(errorMessage) {
  const userId = process.env.MY_LINE_USER_ID;
  if (!userId) {
    console.error('MY_LINE_USER_ID is not set.');
    return;
  }

  const message = {
    type: 'text',
    text: `🚨 cha-line 봇 실행 중 에러가 발생했습니다.\n\n[에러 내용]\n${errorMessage}`,
  };

  try {
    await lineClient.pushMessage(userId, message);
    console.log('Successfully sent error message to LINE.');
  } catch (error) {
    console.error('Failed to send error message to LINE:', error.originalError.response.data);
  }
}