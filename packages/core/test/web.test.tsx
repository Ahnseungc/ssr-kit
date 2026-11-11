import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { notFound, redirect } from '../src/core/errors';
import type { RouteModule } from '../src/core/types';
import { ssrKit } from '../src/hono/index';
import { DefaultDocument } from '../src/react/components';
import { useActionData, useLoaderData } from '../src/react/hooks';
import type { ServerBuild } from '../src/server/build';
import { createWebHandler, getWebRequest } from '../src/web/index';

const Page = () => <h1>{useLoaderData<() => { name: string }>().name}</h1>;

const Echo = () => <p id="echo">{JSON.stringify(useActionData() ?? null)}</p>;

const modules: Record<string, RouteModule> = {
  echo: {
    default: Echo,
    action: async ({ request }) => {
      const form = await request.formData();
      if (form.get('go')) redirect('/page');
      return { name: form.get('name') };
    },
  },
  page: {
    default: Page,
    loader: ({ request, headers, context }) => {
      headers.append('set-cookie', 'a=1');
      headers.append('set-cookie', 'b=2');
      const ua = getWebRequest(request).headers.get('user-agent');
      return { name: `${(context as { who?: string }).who ?? 'web'}:${ua ?? '-'}` };
    },
  },
  missing: { default: Page, loader: () => notFound() },
  old: { default: Page, loader: () => redirect('/page', 301) },
};

const build: ServerBuild = {
  routes: Object.keys(modules).map((id) => ({
    id,
    path: `/${id}`,
    module: () => Promise.resolve(modules[id]!),
  })),
  Document: DefaultDocument,
  dataPrefix: '/_data',
  dev: false,
  bootstrapModules: [],
  resolveAssets: () => ({ modules: [], styles: [] }),
};

const get = (path: string, init?: RequestInit) =>
  new Request(`http://localhost${path}`, { headers: { 'user-agent': 'test-ua' }, ...init });

describe('createWebHandler', () => {
  const handle = createWebHandler({ build });

  it('HTML 을 Response 스트림으로 돌려주고 Set-Cookie 를 유지한다', async () => {
    const response = (await handle(get('/page')))!;
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.getSetCookie()).toEqual(['a=1', 'b=2']);
    expect(await response.text()).toContain('<h1>web:test-ua</h1>');
  });

  it('404·redirect·데이터 엔드포인트', async () => {
    expect((await handle(get('/missing')))!.status).toBe(404);
    const redirected = (await handle(get('/old')))!;
    expect(redirected.status).toBe(301);
    expect(redirected.headers.get('location')).toBe('/page');
    const data = (await handle(get('/_data/page')))!;
    expect(data.headers.get('content-type')).toContain('application/json');
    expect(await data.json()).toMatchObject({ type: 'data' });
  });

  it('HEAD 는 본문이 없고, 매치가 없으면 next 모드에서 null', async () => {
    const head = (await handle(get('/page', { method: 'HEAD' })))!;
    expect(head.status).toBe(200);
    expect(head.body).toBeNull();
    expect(await createWebHandler({ build }, 'next')(get('/nope'))).toBeNull();
    expect((await handle(get('/nope')))!.status).toBe(404);
  });

  it('GET·HEAD 외 메서드는 action 이 없으면 405 (next 모드면 null)', async () => {
    expect((await handle(get('/page', { method: 'POST' })))!.status).toBe(405);
    const next = createWebHandler({ build }, 'next');
    expect(
      await next(get('/page', { method: 'POST', headers: { origin: 'http://localhost' } })),
    ).toBeNull();
  });

  const postForm = (path: string, values: Record<string, string>, origin = 'http://localhost') =>
    get(path, { method: 'POST', body: new URLSearchParams(values), headers: { origin } });

  it('action: Request 본문을 읽고 actionData 로 렌더, redirect 는 303, 출처가 다르면 403', async () => {
    const response = (await handle(postForm('/echo', { name: '웹' })))!;
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('{&quot;name&quot;:&quot;웹&quot;}');
    const redirected = (await handle(postForm('/echo', { go: '1' })))!;
    expect(redirected.status).toBe(303);
    expect(redirected.headers.get('location')).toBe('/page');
    expect((await handle(postForm('/echo', {}, 'https://evil.test')))!.status).toBe(403);
  });
});

describe('Hono ssrKit', () => {
  const app = new Hono();
  app.use('*', ssrKit({ build, getContext: (c) => ({ who: c.req.header('x-who') ?? 'hono' }) }));
  app.get('/api/ping', (c) => c.text('pong'));
  app.post('/page', (c) => c.text('api'));

  it('렌더하고 getContext 에 요청별 Context 를 넘긴다', async () => {
    const [first, second] = await Promise.all([
      app.request('/page', { headers: { 'x-who': 'kim', 'user-agent': 'ua1' } }),
      app.request('/page', { headers: { 'x-who': 'lee', 'user-agent': 'ua2' } }),
    ]);
    expect(await first.text()).toContain('<h1>kim:ua1</h1>');
    expect(await second.text()).toContain('<h1>lee:ua2</h1>');
  });

  it('매치가 없으면 다음 핸들러로 넘긴다', async () => {
    const response = await app.request('/api/ping');
    expect(await response.text()).toBe('pong');
  });

  it('action: c.req.raw 본문을 읽는다. action 이 없는 POST 는 다음 핸들러로', async () => {
    const init = (body: URLSearchParams) => ({
      method: 'POST',
      body,
      headers: { origin: 'http://localhost' },
    });
    const response = await app.request('/_data/echo', init(new URLSearchParams({ name: '호노' })));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ type: 'data' });
    const passed = await app.request('/page', init(new URLSearchParams()));
    expect(await passed.text()).toBe('api');
  });
});
