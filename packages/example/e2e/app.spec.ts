import { execFileSync } from 'node:child_process';
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

test('Promise 데이터: 셸을 먼저 보내고 Suspense 경계를 스트리밍으로 채운다', async ({
  page,
  request,
}) => {
  const html = await (await request.get('/stream')).text();
  expect(html).toContain('차트 불러오는 중');
  expect(html).toMatch(/__SSRKR\(0,1,/);

  const errors = collectErrors(page);
  await page.goto('/stream');
  await expect(page.getByTestId('chart')).toContainText('152000');
  await expect(page.getByTestId('chart')).toContainText('(date)');
  expect(errors).toEqual([]);
});

test('Promise 데이터: 클라 이동으로 들어와도 Suspense 로 그린다', async ({ page }) => {
  await page.goto('/');
  await hydrated(page);
  await page.getByRole('link', { name: '스트리밍' }).click();
  await expect(page.getByRole('heading', { name: '실시간 시세' })).toBeVisible();
  await expect(page.getByTestId('chart')).toContainText('(date)');
});

test('prerender CLI 가 정적 HTML 을 만든다', () => {
  const root = path.join(import.meta.dirname, '..');
  execFileSync('pnpm', ['run', 'prerender'], { cwd: root, stdio: 'pipe' });
  const html = readFileSync(path.join(root, 'dist/prerendered/gold/1/index.html'), 'utf8');
  expect(html).toContain('순금 24K');
  expect(readFileSync(path.join(root, 'dist/prerendered/index.html'), 'utf8')).toContain('금 시세');
});

test('useRevalidate: 문서를 다시 받지 않고 로더만 다시 실행한다', async ({ page }) => {
  await page.goto('/about');
  await hydrated(page);
  await markDocument(page);
  const before = await page.getByTestId('rendered-ms').textContent();
  const dataRequest = page.waitForRequest((r) => r.url().includes('/_data/about'));
  await page.getByRole('button', { name: '새로고침' }).click();
  await dataRequest;
  await expect(page.getByTestId('rendered-ms')).not.toHaveText(before!);
  expect(await isSameDocument(page)).toBe(true);
  await expect(page).toHaveURL('/about');
});

test('useNavigation: 느린 이동 중 로딩 상태를 보여 준다', async ({ page }) => {
  await page.goto('/');
  await hydrated(page);
  await page.getByRole('link', { name: '스트리밍' }).click();
  await expect(page.getByText('불러오는 중…')).toBeVisible();
  await expect(page.getByRole('heading', { name: '실시간 시세' })).toBeVisible();
  await expect(page.getByText('불러오는 중…')).toBeHidden();
});

test('해시 링크는 데이터 요청 없이 URL 해시만 바꾼다', async ({ page }) => {
  await page.goto('/');
  await hydrated(page);
  const dataRequests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/_data/')) dataRequests.push(r.url());
  });
  await markDocument(page);
  await page.getByRole('link', { name: '메모로' }).click();
  await expect(page).toHaveURL('/#memo-section');
  expect(dataRequests).toEqual([]);
  expect(await isSameDocument(page)).toBe(true);
});

test('수정 키(Ctrl/Meta) 클릭은 가로채지 않는다', async ({ page, context }) => {
  await page.goto('/');
  await hydrated(page);
  const popup = context.waitForEvent('page');
  await page
    .getByRole('navigation')
    .getByRole('link', { name: '소개' })
    .click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] });
  const opened = await popup;
  await opened.waitForLoadState();
  expect(new URL(opened.url()).pathname).toBe('/about');
  await expect(page).toHaveURL('/');
});

test('다른 origin 으로의 redirect 는 클라 이동에서도 문서 이동으로 따라간다', async ({ page }) => {
  await page.route('https://example.com/**', (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<h1>외부 사이트</h1>' }),
  );
  await page.goto('/');
  await hydrated(page);
  await page.getByRole('link', { name: '외부' }).click();
  await expect(page).toHaveURL('https://example.com/ssr-kit');
  await expect(page.getByRole('heading', { name: '외부 사이트' })).toBeVisible();
});

test('TanStack Query 레시피: SSR 데이터로 hydrate 하고 첫 로드에 다시 요청하지 않는다', async ({
  page,
  request,
}) => {
  const html = await (await request.get('/query')).text();
  expect(html).toContain('152,000원');

  const apiCalls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/gold-price')) apiCalls.push(r.url());
  });
  const errors = collectErrors(page);
  await page.goto('/query');
  await hydrated(page);
  await expect(page.getByTestId('query-price')).toHaveText('152,000원');
  await page.waitForTimeout(300);
  expect(apiCalls).toEqual([]);
  expect(errors).toEqual([]);
});

test('viewport 프리패치: 화면에 보이는 링크의 라우트 모듈만 받고 데이터는 받지 않는다', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (r) => requests.push(new URL(r.url()).pathname));
  await page.goto('/about');
  await hydrated(page);
  // nav 의 18K 링크(prefetch="viewport") → GoldDetail 청크
  await expect.poll(() => requests.some((p) => /\/assets\/GoldDetail-.*\.js$/.test(p))).toBe(true);
  expect(requests.filter((p) => p.startsWith('/_data/gold'))).toEqual([]);
});

test('TanStack Query 레시피: 클라 이동으로 들어와도 서버 데이터로 그린다', async ({ page }) => {
  const apiCalls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/gold-price')) apiCalls.push(r.url());
  });
  await page.goto('/');
  await hydrated(page);
  await page.getByRole('link', { name: '쿼리' }).click();
  await expect(page.getByTestId('query-price')).toHaveText('152,000원');
  expect(apiCalls).toEqual([]);
});

test('새로고침해도 스크롤 위치를 복원한다', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 300 });
  await page.goto('/about?tall');
  await hydrated(page);
  await page.evaluate(() => window.scrollTo(0, 500));
  await page.reload();
  await hydrated(page);
  // 새로고침 순간 브라우저가 몇 px 조정한 값이 저장될 수 있어 근사로 본다
  await expect.poll(() => page.evaluate(() => Math.abs(window.scrollY - 500) <= 10)).toBe(true);
});

test('미들웨어 가드: 쿠키 없으면 문서 요청은 302 로 로그인, 있으면 통과', async ({ request }) => {
  const denied = await request.get('/admin', { maxRedirects: 0 });
  expect(denied.status()).toBe(302);
  expect(denied.headers().location).toBe('/login?next=/admin');

  const allowed = await request.get('/admin', { headers: { cookie: 'demo_auth=1' } });
  expect(allowed.status()).toBe(200);
  const html = await allowed.text();
  expect(html).toContain('<p data-testid="admin-user">demo</p>');
  // 루트 미들웨어가 context 에 붙인 값을 로더가 받는다
  expect(html).toContain('context-ok');
});

test('미들웨어 가드: 클라 이동도 데이터 요청에서 막혀 로그인으로, 로그인 뒤 접근', async ({
  page,
}) => {
  await page.goto('/');
  await hydrated(page);
  await markDocument(page);
  await page.getByRole('navigation').getByRole('link', { name: '관리자' }).click();
  await expect(page).toHaveURL('/login?next=/admin');
  await expect(page.getByRole('heading', { name: '로그인' })).toBeVisible();

  await page.getByRole('button', { name: '데모 로그인' }).click();
  await expect(page).toHaveURL('/admin');
  await expect(page.getByTestId('admin-user')).toHaveText('demo');
  await expect(page.getByTestId('admin-context')).toHaveText('context-ok');
  expect(await isSameDocument(page)).toBe(true);
});

test('미들웨어는 클라 번들에서 제거된다', () => {
  const dir = path.join(import.meta.dirname, '../dist/client/assets');
  const admin = readdirSync(dir).filter((file) => /^Admin-.*\.js$/.test(file));
  expect(admin.length).toBe(1);
  const text = readFileSync(path.join(dir, admin[0]!), 'utf8');
  expect(text).not.toContain('/login?next=');
  expect(text).toContain('__ssrkLoader');
});

test('prod 기본값은 Server-Timing 헤더를 보내지 않는다', async ({ request }) => {
  const doc = await request.get('/');
  expect(doc.headers()['server-timing']).toBeUndefined();
  const data = await request.get('/_data/gold/1');
  expect(data.headers()['server-timing']).toBeUndefined();
});
