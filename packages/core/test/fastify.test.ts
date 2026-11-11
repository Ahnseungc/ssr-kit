import Fastify from 'fastify';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { notFound, redirect } from '../src/core/errors';
import { deserialize } from '../src/core/serialize';
import type { LoaderArgs, RouteDef, RouteModule } from '../src/core/types';
import { ssrKit } from '../src/fastify/index';
import { DefaultDocument, Outlet } from '../src/react/components';
import { useLoaderData } from '../src/react/hooks';
import type { ServerBuild } from '../src/server/build';

const Layout = () => createElement('main', null, createElement(Outlet));

const Hello = () => {
  const data = useLoaderData<() => { name: string }>();
  return createElement('h1', null, `hello ${data.name}`);
};

const route = (path: string, module: RouteModule): RouteDef => ({
  path,
  module: () => Promise.resolve(module),
});

const routes: RouteDef[] = [
  {
    id: 'root',
    path: '/',
    module: () => Promise.resolve({ default: Layout }),
    children: [
      route('hello', { default: Hello, loader: () => ({ name: 'ssr' }) }),
      route('missing', {
        default: Hello,
        loader: () => notFound(),
      }),
      route('old', { default: Hello, loader: () => redirect('/hello', 301) }),
      route('cookies', {
        default: Hello,
        loader: ({ headers }: LoaderArgs) => {
          headers.append('set-cookie', 'a=1; Path=/');
          headers.append('set-cookie', 'b=2; Path=/');
          return { name: 'cookie' };
        },
      }),
    ],
  },
];

const build: ServerBuild = {
  routes,
  Document: DefaultDocument,
  dataPrefix: '/_data',
  dev: false,
  bootstrapModules: [],
  resolveAssets: () => ({ modules: [], styles: [] }),
};

const createApp = async () => {
  const app = Fastify();
  await app.register(ssrKit, { build });
  return app;
};

describe('ssr-kit/fastify', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('로더 데이터로 HTML 을 렌더한다', async () => {
    const app = await createApp();
    const res = await app.inject({ method: 'GET', url: '/hello' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('hello ssr');
    expect(res.body).toContain('window.__SSRK=');
  });

  it('notFound() 는 404', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = await createApp();
    const res = await app.inject({ method: 'GET', url: '/missing' });
    expect(res.statusCode).toBe(404);
  });

  it('매치 라우트가 없으면 404 렌더', async () => {
    const app = await createApp();
    const res = await app.inject({ method: 'GET', url: '/nope/deep' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('redirect() 는 상태와 location 을 쓴다', async () => {
    const app = await createApp();
    const res = await app.inject({ method: 'GET', url: '/old' });
    expect(res.statusCode).toBe(301);
    expect(res.headers.location).toBe('/hello');
  });

  it('데이터 요청은 JSON', async () => {
    const app = await createApp();
    const res = await app.inject({ method: 'GET', url: '/_data/hello' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    const body = res.json<{ type: string; payload: unknown[] }>();
    expect(body.type).toBe('data');
    expect(deserialize(body.payload)).toMatchObject({
      data: { 'root-0': { name: 'ssr' } },
      status: 200,
    });
  });

  it('Set-Cookie 여러 개를 유지한다', async () => {
    const app = await createApp();
    const res = await app.inject({ method: 'GET', url: '/cookies' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['set-cookie']).toEqual(['a=1; Path=/', 'b=2; Path=/']);
  });

  it('HEAD 는 본문 없이 헤더만', async () => {
    const app = await createApp();
    const res = await app.inject({ method: 'HEAD', url: '/hello' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toBe('');
  });

  it('getContext 는 Fastify 요청을 받는다', async () => {
    const getContext = vi.fn(() => ({}));
    const app = Fastify();
    await app.register(ssrKit, { build, getContext });
    await app.inject({ method: 'GET', url: '/hello' });
    expect(getContext).toHaveBeenCalledWith(expect.objectContaining({ url: '/hello' }));
  });
});
