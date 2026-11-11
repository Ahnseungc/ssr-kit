import { expect, type Page, test } from '@playwright/test';

const hydrated = (page: Page) =>
  page.waitForFunction(() => document.body.querySelector('nav') && '__SSRK' in window);

/** 전체 문서 새로고침이 일어나면 사라지는 표시 */
const markDocument = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { __mark: boolean }).__mark = true;
  });
const isSameDocument = (page: Page) =>
  page.evaluate(() => (window as unknown as { __mark?: boolean }).__mark === true);

/** 병렬 테스트가 같은 Memo리 Guestbook을 쓰므로 글마다 고유하게 */
const uniqueMessage = (label: string) =>
  `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

const ACTION_DELAY_MS = 400;

test('JS 제출: 문서를 다시 받지 않고 submitting 상태를 보여 준 뒤 redirect 로 목록을 갱신한다', async ({
  page,
}) => {
  const message = uniqueMessage('js');
  await page.goto('/guestbook');
  await hydrated(page);
  await markDocument(page);

  // 대기 상태를 확실히 보려고 action 요청만 늦춘다
  await page.route('**/_data/guestbook', async (route) => {
    if (route.request().method() === 'POST') {
      await new Promise((r) => setTimeout(r, ACTION_DELAY_MS));
    }
    await route.continue();
  });
  const methods: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/_data/guestbook')) methods.push(r.method());
  });

  await page.getByLabel('Message').fill(message);
  await page.getByRole('button', { name: 'Post' }).click();
  const pending = page.getByRole('button', { name: 'Posting…' });
  await expect(pending).toBeVisible();
  await expect(pending).toBeDisabled();

  await expect(
    page.getByTestId('guestbook-entries').getByText(message, { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Post' })).toBeEnabled();
  // redirect 로 돌아오면 폼이 비워진다
  await expect(page.getByLabel('Message')).toHaveValue('');
  await expect(page).toHaveURL('/guestbook');
  expect(methods).toEqual(['POST', 'GET']);
  expect(await isSameDocument(page)).toBe(true);
});

test('검증 실패는 useActionData 로 보여 주고 입력을 유지한다', async ({ page }) => {
  await page.goto('/guestbook');
  await hydrated(page);
  await markDocument(page);
  await page.getByRole('button', { name: 'Post' }).click();
  await expect(page.getByRole('alert')).toHaveText('Please write something');

  const tooLong = '가'.repeat(41);
  await page.getByLabel('Message').fill(tooLong);
  await page.getByRole('button', { name: 'Post' }).click();
  await expect(page.getByRole('alert')).toHaveText('Keep it under 40 characters');
  await expect(page.getByLabel('Message')).toHaveValue(tooLong);
  expect(await isSameDocument(page)).toBe(true);

  // 다른 페이지로 이동하면 actionData 는 사라진다
  await page.getByRole('link', { name: 'About' }).click();
  await page.getByRole('link', { name: 'Guestbook' }).click();
  await expect(page.getByRole('heading', { name: 'Guestbook' })).toBeVisible();
  await expect(page.getByRole('alert')).toBeHidden();
});

test('다른 출처(Origin 없음)의 POST 는 403', async ({ request }) => {
  const response = await request.post('/guestbook', { form: { message: 'csrf' } });
  expect(response.status()).toBe(403);
});

test.describe('JS 없이 (progressive enhancement)', () => {
  test.use({ javaScriptEnabled: false });

  test('일반 <form> POST 가 303 으로 돌아와 목록에 반영된다', async ({ page }) => {
    const message = uniqueMessage('nojs');
    await page.goto('/guestbook');
    await page.getByLabel('Message').fill(message);
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Post' }).click(),
    ]);
    expect(response.status()).toBe(303);
    await expect(
      page.getByTestId('guestbook-entries').getByText(message, { exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL('/guestbook');
  });

  test('검증 실패는 서버 렌더 문서에 그대로 나온다', async ({ page }) => {
    await page.goto('/guestbook');
    await page.getByRole('button', { name: 'Post' }).click();
    await expect(page.getByRole('alert')).toHaveText('Please write something');
  });
});
