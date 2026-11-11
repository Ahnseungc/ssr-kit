import { expect, type Page, test } from '@playwright/test';

/**
 * @vitejs/plugin-legacy (vite.config.ts) 연동.
 * Playwright Chromium 은 ES 모듈을 끌 수 없어 실제 구형 엔진은 돌리지 못한다.
 * nomodule 브라우저는 HTML 을 고쳐 흉내 낸다: 모듈 스크립트를 빼고 nomodule 을 지워
 * 클래식 스크립트(폴리필 + SystemJS 레거시 번들)만으로 hydrate 되는지 본다.
 */

const LEGACY_POLYFILL =
  /<script nomodule crossorigin id="vite-legacy-polyfill" src="\/assets\/polyfills-legacy-[\w-]+\.js"><\/script>/;
const LEGACY_ENTRY =
  /<script nomodule crossorigin id="vite-legacy-entry" data-src="\/assets\/client-entry-legacy-[\w-]+\.js">System\.import\(/;

const collectErrors = (page: Page) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
};

const collectScripts = (page: Page) => {
  const scripts: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'script') scripts.push(new URL(request.url()).pathname);
  });
  return scripts;
};

const clickCounter = async (page: Page) => {
  const button = page.getByRole('button', { name: /Clicked/ });
  await expect(async () => {
    await button.click();
    await expect(button).not.toHaveText('Clicked 0');
  }).toPass();
};

/** nomodule 브라우저가 보는 문서: 모듈 스크립트·modulepreload 는 무시되고 nomodule 스크립트는 실행된다 */
const asNoModuleBrowser = (html: string) =>
  html
    .replace(/<link rel="modulepreload"[^>]*>/g, '')
    .replace(/<script type="module"[^>]*>[\s\S]*?<\/script>/g, '')
    .replace(/<script nomodule/g, '<script');

test('legacy: React 출력 뒤에 nomodule 폴리필·엔트리와 감지 스크립트를 한 번 붙인다', async ({
  request,
}) => {
  const html = await (await request.get('/')).text();
  const tail = html.slice(html.indexOf('</html>'));
  expect(tail).toMatch(LEGACY_POLYFILL);
  expect(tail).toMatch(LEGACY_ENTRY);
  expect(tail).toContain('window.__vite_is_modern_browser=true');
  expect(html.match(/id="vite-legacy-entry"/g)).toHaveLength(1);
  // 모던 엔트리는 그대로 React 부트스트랩 모듈
  expect(html).toMatch(/<script type="module" src="\/assets\/client-entry-[\w-]+\.js" async/);

  const head = await request.head('/');
  expect(await head.text()).toBe('');
});

test('legacy: 모던 브라우저는 레거시 번들을 받지 않고 한 번만 hydrate 한다', async ({ page }) => {
  const errors = collectErrors(page);
  const scripts = collectScripts(page);
  await page.goto('/');
  await page.waitForFunction(() => '__vite_is_modern_browser' in window);
  await clickCounter(page);
  expect(await page.evaluate(() => 'System' in window)).toBe(false);
  expect(scripts.filter((url) => url.includes('-legacy'))).toEqual([]);
  expect(scripts.filter((url) => /\/client-entry-[\w-]+\.js$/.test(url))).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('legacy: nomodule 브라우저 흉내 — SystemJS 레거시 번들만으로 hydrate·클라 이동한다', async ({
  page,
}) => {
  const errors = collectErrors(page);
  const scripts = collectScripts(page);
  await page.route(
    (url) => url.pathname === '/',
    async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, body: asNoModuleBrowser(await response.text()) });
    },
  );
  await page.goto('/');
  await page.waitForFunction(() => '__SSRK' in window && 'System' in window);
  await clickCounter(page);

  const dataRequest = page.waitForRequest((r) => r.url().includes('/_data/gold/1'));
  await page.getByRole('navigation').getByRole('link', { name: '24K' }).click();
  await dataRequest;
  await expect(page.getByRole('heading', { name: '24K Gold' })).toBeVisible();

  const executed = scripts.filter((url) => url.endsWith('.js'));
  expect(executed.some((url) => /polyfills-legacy-/.test(url))).toBe(true);
  expect(executed.some((url) => /client-entry-legacy-/.test(url))).toBe(true);
  expect(executed.some((url) => /GoldDetail-legacy-/.test(url))).toBe(true);
  // 모던 청크는 받지도 않는다
  expect(executed.filter((url) => !/-legacy-/.test(url))).toEqual([]);
  expect(errors).toEqual([]);
});
