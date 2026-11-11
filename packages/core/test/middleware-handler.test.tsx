import { describe, expect, it, vi } from 'vitest';

import { httpError, redirect } from '../src/core/errors';
import type { RouteError, RouteModule } from '../src/core/types';
import { createEdgeHandler } from '../src/edge/index';
import { createSsrHandler } from '../src/node/index';
import { DefaultDocument, Outlet } from '../src/react/components';
import { useLoaderData } from '../src/react/hooks';
import { toHandleOptions } from '../src/server/adapter';
import type { ServerBuild } from '../src/server/build';
import { formatServerTiming, toTimingName } from '../src/server/timing';
import { createWebHandler } from '../src/web/index';

const Layout = () => (
  <div id="layout">
    <Outlet />
  </div>
);
const Admin = () => <h1>{useLoaderData<() => { who: string }>().who}</h1>;
const Boundary = ({ error }: { error: RouteError }) => <p id="boundary">{error.status}</p>;

const rootMiddleware = vi.fn(({ context }: { context: object }) => {
  (context as { startedAt?: number }).startedAt = 1;
});

const modules: Record<string, RouteModule> = {
  root: { default: Layout, ErrorBoundary: Boundary, middleware: rootMiddleware },
  admin: {
    default: Admin,
    middleware: ({ request, context }) => {
      if (!request.headers.get('cookie')?.includes('auth=1')) redirect('/login?next=/admin');
      (context as { who?: string }).who = 'admin';
    },
    loader: ({ context }) => ({
      who: `${(context as { who: string }).who}@${(context as { startedAt: number }).startedAt}`,
    }),
  },
  forbidden: { default: Admin, middleware: () => httpError(403, '금지') },
  'gold/[id]': { default: Admin, loader: () => ({ who: 'gold' }) },
};

const build: ServerBuild = {
  routes: [
    {
      id: 'root',
      module: () => Promise.resolve(modules.root!),
      children: ['admin', 'forbidden'].map((id) => ({
        id,
        path: id,
        module: () => Promise.resolve(modules[id]!),
      })),
    },
    {
      id: 'gold/[id]',
      path: '/gold/:id',
      module: () => Promise.resolve(modules['gold/[id]']!),
    },
  ],
  Document: DefaultDocument,
  dataPrefix: '/_data',
  dev: false,
  bootstrapModules: [],
  resolveAssets: () => ({ modules: [], styles: [] }),
};

const get = (path: string, cookie?: string) =>
  new Request(`http://localhost${path}`, { headers: cookie ? { cookie } : {} });

describe('라우트 미들웨어 (핸들러)', () => {
  const handle = createWebHandler({ build });

  it('문서: 쿠키가 없으면 미들웨어 redirect, 있으면 context 를 거쳐 로더 데이터 렌더', async () => {
    const denied = (await handle(get('/admin')))!;
    expect(denied.status).toBe(302);
    expect(denied.headers.get('location')).toBe('/login?next=/admin');

    const allowed = (await handle(get('/admin', 'auth=1')))!;
    expect(allowed.status).toBe(200);
    expect(await allowed.text()).toContain('<h1>admin@1</h1>');
  });

  it('데이터 엔드포인트도 미들웨어를 거친다 (redirect 는 type: redirect)', async () => {
    const before = rootMiddleware.mock.calls.length;
    const denied = (await handle(get('/_data/admin')))!;
    expect(denied.status).toBe(200);
    expect(await denied.json()).toEqual({
      type: 'redirect',
      to: '/login?next=/admin',
      status: 302,
    });
    // 로더 없는 루트 미들웨어도 데이터 요청마다 실행
    expect(rootMiddleware.mock.calls.length).toBe(before + 1);
  });

  it('미들웨어 httpError → 가장 가까운 ErrorBoundary + 상태 (문서·데이터)', async () => {
    const doc = (await handle(get('/forbidden')))!;
    expect(doc.status).toBe(403);
    expect(doc.headers.get('cache-control')).toBe('no-store');
    expect(await doc.text()).toContain('<p id="boundary">403</p>');

    const data = (await handle(get('/_data/forbidden')))!;
    expect(data.status).toBe(403);
    expect(await data.text()).toContain('금지');
  });

  it('일반 Error 는 onError(phase: middleware) 로 보고', async () => {
    const onError = vi.fn();
    const crash = new Error('mw crash');
    const crashBuild: ServerBuild = {
      ...build,
      routes: [
        {
          id: 'crash',
          path: '/crash',
          module: () =>
            Promise.resolve({
              default: Admin,
              middleware: () => {
                throw crash;
              },
            }),
        },
      ],
    };
    const res = (await createWebHandler({ build: crashBuild, onError })(get('/crash')))!;
    expect(res.status).toBe(500);
    expect(onError).toHaveBeenCalledWith(crash, {
      url: 'http://localhost/crash',
      phase: 'middleware',
    });
  });
});

const TIMING = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+;dur=\d+(\.\d)?$/;

describe('Server-Timing', () => {
  it('serverTiming: true 면 문서 응답에 mw·로더별·shell 이 well-formed 로 붙는다', async () => {
    const res = (await createWebHandler({ build, serverTiming: true })(get('/admin', 'auth=1')))!;
    const header = res.headers.get('server-timing')!;
    const entries = header.split(', ');
    for (const entry of entries) expect(entry).toMatch(TIMING);
    expect(entries.map((e) => e.split(';')[0])).toEqual(['mw', 'loader-admin', 'shell']);
    await res.text();
  });

  it('데이터 응답·redirect 응답에도 붙고, 라우트 id 는 토큰 문자로 바꾼다', async () => {
    const handle = createWebHandler({ build, serverTiming: true });
    const data = (await handle(get('/_data/gold/1')))!;
    expect(data.headers.get('server-timing')).toMatch(/^loader-gold--id-;dur=/);
    const redirected = (await handle(get('/admin')))!;
    expect(redirected.headers.get('server-timing')).toMatch(/^mw;dur=/);
  });

  it('edge 렌더러도 셸 시점에 붙인다', async () => {
    const res = (await createEdgeHandler({ build, serverTiming: true })(get('/gold/1')))!;
    expect(res.headers.get('server-timing')).toMatch(/^loader-gold--id-;dur=[\d.]+, shell;dur=/);
    await res.text();
  });

  it('기본(prod build)은 붙이지 않고 onTiming 으로만 알린다', async () => {
    const onTiming = vi.fn();
    const res = (await createWebHandler({ build, onTiming })(get('/admin', 'auth=1')))!;
    expect(res.headers.has('server-timing')).toBe(false);
    await res.text();
    expect(onTiming).toHaveBeenCalledOnce();
    const [entries, info] = onTiming.mock.calls[0]!;
    expect(entries.map((e: { name: string }) => e.name)).toEqual(['mw', 'loader-admin', 'shell']);
    expect(info).toEqual({ url: 'http://localhost/admin' });
  });

  it('Node 어댑터: HEAD 문서 응답에도 붙는다', async () => {
    const { createServer } = await import('node:http');
    const server = createServer((req, res) => {
      void createSsrHandler({ build, serverTiming: true })(req, res);
    });
    await new Promise<void>((r) => server.listen(0, r));
    const { port } = server.address() as { port: number };
    try {
      const res = await fetch(`http://localhost:${port}/gold/1`, { method: 'HEAD' });
      expect(res.headers.get('server-timing')).toMatch(/^loader-gold--id-;dur=[\d.]+, shell;dur=/);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('serverTiming 기본값은 build.dev 를 따른다', () => {
    const resolve = (dev: boolean, serverTiming?: boolean) =>
      toHandleOptions({ build: { ...build, dev }, serverTiming }, {}, undefined, 'render')
        .serverTiming;
    expect(resolve(true)).toBe(true);
    expect(resolve(false)).toBe(false);
    expect(resolve(true, false)).toBe(false);
    expect(resolve(false, true)).toBe(true);
  });

  it('이름 정규화·포맷', () => {
    expect(toTimingName('gold/[id] 상세')).toBe('gold--id----');
    expect(toTimingName('')).toBe('-');
    expect(
      formatServerTiming([
        { name: 'a', dur: 1.234 },
        { name: 'b', dur: 10 },
      ]),
    ).toBe('a;dur=1.2, b;dur=10');
  });
});
