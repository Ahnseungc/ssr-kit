import { describe, expect, it } from 'vitest';

import { toHandleOptions } from '../src/server/adapter';
import type { ServerBuild } from '../src/server/build';

const isBot = (ua: string) =>
  toHandleOptions({ build: {} as ServerBuild }, null, ua, 'render').isBot;

describe('기본 봇 판별', () => {
  it.each([
    ['Googlebot', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
    ['Bingbot', 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)'],
    ['네이버 Yeti', 'Mozilla/5.0 (compatible; Yeti/1.1; +https://naver.me/spd)'],
    [
      '다음 Daumoa',
      'Mozilla/5.0 (compatible; Daum/4.1; +http://cs.daum.net/faq/15/4118.html) Daumoa',
    ],
    ['카톡 미리보기', 'facebookexternalhit/1.1; kakaotalk-scrap/1.0'],
    ['Ahrefs', 'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)'],
  ])('%s 는 봇', (_, ua) => expect(isBot(ua)).toBe(true));

  it.each([
    [
      '네이버 앱',
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36 NAVER(inapp; search; 2000; 12.10.1)',
    ],
    [
      '다음 앱',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 DaumApps/8.0.0 DaumDevice/mobile',
    ],
    [
      '카카오톡 인앱',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 KAKAOTALK 10.8.0',
    ],
    [
      'CUBOT 폰',
      'Mozilla/5.0 (Linux; Android 11; CUBOT KINGKONG 5 Pro) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36',
    ],
    [
      'Chrome',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0 Safari/537.36',
    ],
  ])('%s 는 사람', (_, ua) => expect(isBot(ua)).toBe(false));
});
