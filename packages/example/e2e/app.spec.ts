import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, type Page, test } from '@playwright/test';

const collectErrors = (page: Page) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
};

/** 전체 문서 새로고침이 일어나면 사라지는 표시 */
const markDocument = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { __mark: boolean }).__mark = true;
  });
const isSameDocument = (page: Page) =>
  page.evaluate(() => (window as unknown as { __mark?: boolean }).__mark === true);

const hydrated = (page: Page) =>
  page.waitForFunction(() => document.body.querySelector('nav') && '__SSRK' in window);

test('JS 없이도 SSR HTML 에 데이터·head·프리로드가 들어 있다', async ({ request }) => {
  const response = await request.get('/');
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toBe('private, no-store');
  const html = await response.text();
  expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
  expect(html).toContain('<title>ssr-kit 예제</title>');
  expect(html).toContain('순금 24K');
  expect(html).toMatch(/<link rel="modulepreload"[^>]+Home-/);
  expect(html).toMatch(/<link rel="stylesheet"[^>]+\.css/);
});

test('hydrate 후 불일치 없이 상호작용된다 (useId 포함)', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await hydrated(page);
  const button = page.getByRole('button', { name: /눌림/ });
  await expect(async () => {
    await button.click();
    await expect(button).not.toHaveText('눌림 0');
  }).toPass();
  await expect(page.getByLabel('메모')).toBeVisible();
  await expect(page.getByTestId('rendered-at')).toHaveText('date');
  expect(errors).toEqual([]);
});

test('Link 이동은 문서를 다시 받지 않고 데이터 엔드포인트만 호출한다', async ({ page }) => {
  await page.goto('/');
  await hydrated(page);
  await markDocument(page);
  const dataRequest = page.waitForRequest((r) => r.url().includes('/_data/gold/1'));
  await page.getByRole('navigation').getByRole('link', { name: '순금' }).click();
  await dataRequest;
  await expect(page.getByRole('heading', { name: '순금 24K' })).toBeVisible();
  await expect(page).toHaveURL('/gold/1');
  await expect(page).toHaveTitle('순금 24K 시세');
  expect(await isSameDocument(page)).toBe(true);
});

test('이동마다 매치된 loader 를 데이터 요청 1번으로 실행한다', async ({ page }) => {
  const dataRequests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/_data/')) dataRequests.push(r.url());
  });
  await page.goto('/about');
  await hydrated(page);
  await page.getByRole('link', { name: '홈' }).click();
  await expect(page.getByRole('heading', { name: '금 시세' })).toBeVisible();
  const before = dataRequests.length;
  await page.getByRole('link', { name: '소개' }).click();
  await expect(page.getByRole('heading', { name: '소개' })).toBeVisible();
  // 루트 레이아웃에 loader 가 있으므로 /about 도 데이터를 받는다
  expect(dataRequests.length).toBe(before + 1);
});

test('notFound() 는 404 와 가장 가까운 ErrorBoundary', async ({ page }) => {
  const response = await page.goto('/gold/missing');
  expect(response?.status()).toBe(404);
  await expect(page.getByTestId('gold-error')).toContainText('404');
  await expect(page.getByRole('navigation')).toBeVisible();
});

test('일반 에러는 500, prod 에서 내부 메시지를 숨긴다', async ({ page }) => {
  const response = await page.goto('/boom');
  expect(response?.status()).toBe(500);
  await expect(page.getByTestId('root-error')).toContainText('Internal Server Error');
  await expect(page.locator('body')).not.toContainText('DB 접속 정보');
});

test('클라 이동 중 에러도 ErrorBoundary 로 그린다', async ({ page }) => {
  await page.goto('/');
  await hydrated(page);
  await page.getByRole('link', { name: '없는 금' }).click();
  await expect(page.getByTestId('gold-error')).toContainText('404');
  await page.getByRole('link', { name: '순금' }).first().click();
  await expect(page.getByRole('heading', { name: '순금 24K' })).toBeVisible();
});

test('redirect: 문서 요청은 301, 클라 이동은 대상 경로로 교체', async ({ page, request }) => {
  const response = await request.get('/old-gold/1', { maxRedirects: 0 });
  expect(response.status()).toBe(301);
  expect(response.headers().location).toBe('/gold/1');

  await page.goto('/');
  await hydrated(page);
  await page.getByRole('link', { name: '옛 주소' }).click();
  await expect(page).toHaveURL('/gold/2');
  await expect(page.getByRole('heading', { name: '18K' })).toBeVisible();
});

test('뒤로가기·앞으로가기와 스크롤 복원', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 300 });
  await page.goto('/');
  await hydrated(page);
  await page.evaluate(() => {
    document.body.style.minHeight = '3000px';
    window.scrollTo(0, 400);
  });
  // click() 은 요소를 화면에 보이게 스크롤하므로 스크롤 없이 이벤트만 보낸다
  await page.getByRole('link', { name: '순금' }).first().dispatchEvent('click', { button: 0 });
  await expect(page.getByRole('heading', { name: '순금 24K' })).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  await page.goBack();
  await expect(page.getByRole('heading', { name: '금 시세' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(400);

  await page.goForward();
  await expect(page.getByRole('heading', { name: '순금 24K' })).toBeVisible();
});

test('ssr:false 라우트는 셸을 보내고 클라에서 데이터를 받아 그린다', async ({ page, request }) => {
  const html = await (await request.get('/shell')).text();
  expect(html).not.toContain('SPA 셸');
  await page.goto('/shell');
  await expect(page.getByTestId('shell')).toHaveText('client-fetch');
});

test('hover 프리패치한 데이터를 이동 때 재사용한다', async ({ page }) => {
  await page.goto('/about');
  await hydrated(page);
  const dataRequests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/_data/gold/1')) dataRequests.push(r.url());
  });
  const link = page.getByRole('navigation').getByRole('link', { name: '순금' });
  await link.hover();
  await expect.poll(() => dataRequests.length).toBe(1);
  await link.click();
  await expect(page.getByRole('heading', { name: '순금 24K' })).toBeVisible();
  expect(dataRequests.length).toBe(1);
});

test('클라이언트 번들에 서버 전용 코드가 없다', () => {
  const dir = path.join(import.meta.dirname, '../dist/client/assets');
  for (const file of readdirSync(dir)) {
    const text = readFileSync(path.join(dir, file), 'utf8');
    expect(text, file).not.toContain('ssr-kit-server-only-secret');
    expect(text, file).not.toContain('DB 접속 정보');
  }
});
