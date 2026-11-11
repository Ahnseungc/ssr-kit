// README 데모 GIF 녹화: 서버를 띄운 뒤 `node scripts/record-demo.mjs [origin]` (기본 http://localhost:4600)
// 결과: docs/assets/demo.gif (ffmpeg 필요)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { chromium } from '@playwright/test';

const origin = process.argv[2] ?? 'http://localhost:4600';
const output = path.resolve(import.meta.dirname, '../../../docs/assets/demo.gif');
const VIEWPORT = { width: 480, height: 400 };
const GIF_WIDTH = 400;
const GIF_FPS = 12;
const ACTION_LATENCY_MS = 700;
/** 첫 페이지가 그려지기 전 빈 화면을 잘라낸다 */
const TRIM_START_S = '0.6';

const videoDir = mkdtempSync(path.join(tmpdir(), 'ssrk-demo-'));
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 2,
  recordVideo: { dir: videoDir, size: VIEWPORT },
});
const page = await context.newPage();

/** 장면 설명을 화면 아래에 띄운다 (React 가 관리하지 않는 <html> 직속에 붙인다) */
const caption = (text) =>
  page.evaluate((value) => {
    let el = document.getElementById('demo-caption');
    if (!el) {
      el = document.createElement('div');
      el.id = 'demo-caption';
      el.style.cssText =
        'position:fixed;left:12px;right:12px;bottom:14px;z-index:9;padding:10px 14px;border-radius:10px;' +
        'background:rgba(22,24,29,.88);color:#fff;font:600 15px/1.4 system-ui,sans-serif;text-align:center';
      document.documentElement.appendChild(el);
    }
    el.textContent = value;
  }, text);

const pause = (ms) => page.waitForTimeout(ms);

// 방명록 제출이 대기 상태를 보이도록 네트워크 지연을 흉내 낸다
await page.route('**/_data/guestbook', async (route) => {
  if (route.request().method() === 'POST') await pause(ACTION_LATENCY_MS);
  await route.continue();
});

// 1. Streaming SSR
await page.goto(`${origin}/stream?delay=1600`, { waitUntil: 'commit' });
await page.waitForSelector('[data-testid=chart-loading]');
await caption('1/3 Streaming SSR: shell first, data streams in');
await page.waitForSelector('[data-testid=chart]');
await pause(1800);

// 2. Form action (no full reload)
await page.getByRole('navigation').getByRole('link', { name: '방명록' }).click();
await page.getByLabel('한마디').waitFor();
await caption('2/3 <Form> action: pending state, no page reload');
await pause(600);
await page.getByLabel('한마디').pressSequentially('Hello from ssr-kit!', { delay: 45 });
await pause(300);
await page.getByRole('button', { name: '남기기' }).click();
await page.getByText('Hello from ssr-kit!', { exact: true }).last().waitFor();
await pause(1500);

// 3. Middleware guard
await caption('3/3 Route middleware: auth guard before loaders');
await pause(700);
await page.getByRole('navigation').getByRole('link', { name: '관리자' }).click();
await page.getByRole('button', { name: '데모 로그인' }).waitFor();
await pause(1200);
await page.getByRole('button', { name: '데모 로그인' }).click();
await page.getByTestId('admin-user').waitFor();
await pause(1800);

await context.close();
await browser.close();

const video = path.join(videoDir, readdirSync(videoDir).find((file) => file.endsWith('.webm')));
const filter = `fps=${GIF_FPS},scale=${GIF_WIDTH}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`;
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', TRIM_START_S, '-i', video, '-vf', filter, output]);
rmSync(videoDir, { recursive: true, force: true });
console.log(`demo GIF → ${output}`);
