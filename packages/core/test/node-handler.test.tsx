import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { Suspense, use } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { RouteModule } from '../src/core/types';
import { createSsrHandler } from '../src/node/index';
import { DefaultDocument, Outlet } from '../src/react/components';
import {
  useLoaderData,
  useLocation,
  useParams,
  useRequestContext,
  useRouteLoaderData,
} from '../src/react/hooks';
import type { ServerBuild } from '../src/server/build';

const never = new Promise<string>(() => {});
const later = <T,>(ms: number, value: T) => new Promise<T>((r) => setTimeout(() => r(value), ms));

const Pending = ({ value }: { value: Promise<string> }) => <b>{use(value)}</b>;

const Layout = () => {
  const ctx = useRequestContext() as { user?: string } | null;
  return (
    <div id="layout" data-user={ctx?.user}>
      <Outlet />
    </div>
  );
};

const Item = () => {
  const params = useParams();
  const location = useLocation();
  const layout = useRouteLoaderData<() => { layout: string }>('layout');
  const { value } = useLoaderData<() => { value: Promise<string> }>();
  return (
    <main>
      <p id="info">{`${params.id}|${location.pathname}|${location.search}|${layout?.layout}`}</p>
      <Suspense fallback={<i id="fallback">로딩</i>}>
        <Pending value={value} />
      </Suspense>
    </main>
  );
};

const Crash = () => {
  throw new Error('렌더 중 폭발');
};

const modules: Record<string, RouteModule> = {
  layout: { default: Layout, loader: () => ({ layout: 'L' }) },
  item: { default: Item, loader: () => ({ value: later(40, 'done') }) },
  hang: { default: Item, loader: () => ({ value: never }) },
  crash: { default: Crash },
};

const build: ServerBuild = {
  routes: [
    {
      id: 'layout',
      module: () => Promise.resolve(modules.layout!),
      children: [
        { id: 'item', path: 'item/:id', module: () => Promise.resolve(modules.item!) },
        { id: 'hang', path: 'hang', module: () => Promise.resolve(modules.hang!) },
        { id: 'crash', path: 'crash', module: () => Promise.resolve(modules.crash!) },
      ],
    },
  ],
  Document: DefaultDocument,
  dataPrefix: '/_data',
  dev: false,
  bootstrapModules: [],
  resolveAssets: () => ({ modules: [], styles: [] }),
};

const onError = vi.fn();
const handler = createSsrHandler({
  build,
  getContext: (req) => ({ user: req.headers['x-user'] as string | undefined }) as never,
  renderTimeout: 200,
  onError,
});

let server: Server;
let base = '';
const nextCalls: string[] = [];

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const next = req.headers['x-next']
      ? () => {
          nextCalls.push(req.url ?? '');
          res.statusCode = 418;
          res.end('next');
        }
      : undefined;
    void handler(req, res, next);
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

const get = (path: string, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, { headers, redirect: 'manual' });

describe('Node 핸들러 (실제 http 서버)', () => {
  it('훅: params·location·상위 라우트 데이터·요청 컨텍스트가 서버 렌더에 반영된다', async () => {
    const html = await (await get('/item/7?q=1', { 'x-user': 'kim' })).text();
    expect(html).toContain('7|/item/7|?q=1|L');
    expect(html).toContain('data-user="kim"');
  });

  it('일반 UA 는 셸을 먼저(fallback 포함), 봇 UA 는 Suspense 를 다 채워서 보낸다 (R3)', async () => {
    const user = await (await get('/item/1', { 'user-agent': 'Mozilla/5.0' })).text();
    expect(user).toContain('id="fallback"');
    const bot = await (await get('/item/1', { 'user-agent': 'Googlebot/2.1' })).text();
    expect(bot).toContain('<b>done</b>');
    expect(bot.indexOf('<b>done</b>')).toBeLessThan(bot.indexOf('</main>'));
    // 셸보다 먼저 settle 된 데이터가 문서 앞(<!DOCTYPE> 앞)에 끼면 안 된다
    expect(bot.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(bot.indexOf('__SSRKR(')).toBeGreaterThan(bot.indexOf('<html'));
  });

  it('renderTimeout: 끝나지 않는 Promise 도 응답을 끝낸다 (R4)', async () => {
    const started = Date.now();
    const response = await get('/hang');
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(html).toContain('id="fallback"');
    expect(html).toMatch(/__SSRKR\(0,0,/);
  });

  it('컴포넌트 렌더 실패는 루트 에러 문서 500 (E2)', async () => {
    const response = await get('/crash');
    expect(response.status).toBe(500);
    expect(await response.text()).toContain('Internal Server Error');
    expect(onError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ phase: 'shell' }),
    );
  });

  it('잘못된 퍼센트 인코딩은 400', async () => {
    expect((await get('/item/%E0%A4%A')).status).toBe(400);
  });

  it('매치가 없으면 next 가 있으면 넘기고, 없으면 404 문서', async () => {
    const passed = await get('/nope', { 'x-next': '1' });
    expect(passed.status).toBe(418);
    expect(nextCalls).toContain('/nope');
    expect((await get('/nope')).status).toBe(404);
  });

  it('POST 는 next 로 넘기거나 405', async () => {
    expect((await fetch(`${base}/item/1`, { method: 'POST' })).status).toBe(405);
  });
});

describe('압축 미들웨어와 함께', () => {
  it('React flush 마다 res.flush() 를 불러 압축 버퍼를 내보낸다', async () => {
    const flushes: number[] = [];
    const server2 = createServer((req, res) => {
      // compression() 이 붙이는 것과 같은 모양
      (res as ServerResponse & { flush: () => void }).flush = () => flushes.push(Date.now());
      void handler(req, res);
    });
    await new Promise<void>((r) => server2.listen(0, r));
    const port = (server2.address() as AddressInfo).port;
    await (
      await fetch(`http://localhost:${port}/item/1`, { headers: { 'user-agent': 'Mozilla/5.0' } })
    ).text();
    await new Promise<void>((r) => server2.close(() => r()));
    // 셸 flush + Suspense 경계 flush
    expect(flushes.length).toBeGreaterThanOrEqual(2);
  });
});
