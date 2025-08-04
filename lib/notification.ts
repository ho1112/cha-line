// /lib/notification.ts

import { Client, Message } from '@line/bot-sdk';

const lineClient = new Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
});

interface DividendData {
  text: string;
  source?: string;
}

export async function sendLineMessage(dividendData: DividendData): Promise<void> {
  const userId = process.env.MY_LINE_USER_ID;
  if (!userId) {
    console.error('MY_LINE_USER_ID is not set.');
    return;
  }

  const messageText = `새로운 배당금이 입금되었습니다!\n\n[상세 내역]\n${dividendData.text}`;

  const message: Message = {
    type: 'text',
    text: messageText,
  };

  try {
    await lineClient.pushMessage(userId, message);
    console.log('Successfully sent dividend notification to LINE.');
  } catch (error: any) {
    console.error('Failed to send LINE message:', error.originalError?.response?.data);
    throw new Error('Failed to send LINE message.');
  }
}

export async function sendErrorMessage(errorMessage: string): Promise<void> {
  const userId = process.env.MY_LINE_USER_ID;
  if (!userId) {
    console.error('MY_LINE_USER_ID is not set.');
    return;
  }

  const message: Message = {
    type: 'text',
    text: `🚨 cha-line 봇 실행 중 에러가 발생했습니다.\n\n[에러 내용]\n${errorMessage}`,
  };

  try {
    await lineClient.pushMessage(userId, message);
    console.log('Successfully sent error message to LINE.');
  } catch (error: any) {
    console.error('Failed to send error message to LINE:', error.originalError?.response?.data);
  }
}