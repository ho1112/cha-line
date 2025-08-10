// /lib/notification.ts

import { Client, Message } from '@line/bot-sdk';

const lineClient = new Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
});

interface DividendData {
  text?: string;
  source?: string;
  type?: 'success' | 'error';
  message?: string;
}

export async function sendLineMessage(dividendData: DividendData): Promise<void> {
  const userId = process.env.MY_LINE_USER_ID;
  if (!userId) {
    console.error('MY_LINE_USER_ID is not set.');
    return;
  }

  // 에러 메시지인 경우
  if (dividendData.type === 'error') {
    const errorMessage: Message = {
      type: 'text',
      text: `🚨 cha-line 봇 실행 중 에러가 발생했습니다.\n\n[에러 내용]\n${dividendData.message || 'Unknown error'}`,
    };
    
    try {
      await lineClient.pushMessage(userId, errorMessage);
      console.log('Successfully sent error message to LINE.');
    } catch (error: any) {
      console.error('Failed to send error message to LINE:', error.originalError?.response?.data);
    }
    return;
  }

  // 성공 메시지인 경우 (기존 로직)
  const messageText = dividendData.text || '새로운 배당금이 입금되었습니다!';
  
  const flexMessage: any = {
    type: 'flex',
    altText: '배당 알림',
    contents: {
      type: 'bubble',
      size: 'mega',
      header: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: '배당 알림', weight: 'bold', size: 'lg' }] },
      body: { type: 'box', layout: 'vertical', spacing: 'md', contents: messageText.split('\n').map((t) => ({ type: 'text', text: t, wrap: true })) },
    },
  };

  try {
    await lineClient.pushMessage(userId, flexMessage as Message);
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

export async function sendFlexMessage(contents: any, altText: string = '배당 알림'): Promise<void> {
  const userId = process.env.MY_LINE_USER_ID;
  if (!userId) {
    console.error('MY_LINE_USER_ID is not set.');
    return;
  }

  const flexMessage: any =
    contents && contents.type === 'flex'
      ? contents
      : { type: 'flex', altText, contents };

  try {
    await lineClient.pushMessage(userId, flexMessage as Message);
    console.log('Successfully sent FLEX message to LINE.');
  } catch (error: any) {
    console.error('Failed to send FLEX message to LINE:', error.originalError?.response?.data || error);
    throw new Error('Failed to send FLEX message.');
  }
}