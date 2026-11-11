import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { notFound, redirect } from '../src/core/errors';
import type { RouteModule } from '../src/core/types';
import { ssrKit } from '../src/hono/index';
import { DefaultDocument } from '../src/react/components';
import { useLoaderData } from '../src/react/hooks';
import type { ServerBuild } from '../src/server/build';
import { createWebHandler, getWebRequest } from '../src/web/index';

const Page = () => <h1>{useLoaderData<() => { name: string }>().name}</h1>;

const modules: Record<string, RouteModule> = {
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

  it('GET·HEAD 외 메서드는 405', async () => {
    expect((await handle(get('/page', { method: 'POST' })))!.status).toBe(405);
  });
});

describe('Hono ssrKit', () => {
  const app = new Hono();
  app.use('*', ssrKit({ build, getContext: (c) => ({ who: c.req.header('x-who') ?? 'hono' }) }));
  app.get('/api/ping', (c) => c.text('pong'));

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
});
