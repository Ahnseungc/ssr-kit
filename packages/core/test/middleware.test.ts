import { describe, expect, it, vi } from 'vitest';

import { httpError, redirect } from '../src/core/errors';
import { runMiddleware, runRoute } from '../src/core/middleware';
import type { Middleware, RouteMatch, RouteModule } from '../src/core/types';

const Page = () => null;
const Boundary = () => null;

const setup = (modules: RouteModule[]) => {
  const matches: RouteMatch[] = modules.map((_, i) => ({
    id: `r${i}`,
    route: { module: () => Promise.resolve(modules[i]!) },
    params: { id: String(i) },
  }));
  const request = {
    url: new URL('http://localhost/x'),
    method: 'GET',
    headers: new Headers(),
    raw: null,
  };
  return {
    matches,
    modules,
    request,
    context: {} as Record<string, unknown>,
    signal: new AbortController().signal,
    dev: false,
  };
};

describe('runMiddleware', () => {
  it('루트 → 리프 onion 순서로 실행하고 맨 안쪽에서 inner 를 부른다', async () => {
    const log: string[] = [];
    const wrap =
      (name: string): Middleware =>
      async (_args, next) => {
        log.push(`${name}:before`);
        await next();
        log.push(`${name}:after`);
      };
    const { matches, modules, ...rest } = setup([
      { default: Page, middleware: [wrap('a1'), wrap('a2')] },
      { default: Page },
      { default: Page, middleware: wrap('c') },
    ]);
    const outcome = await runMiddleware(
      matches,
      modules,
      { ...rest, headers: matches.map(() => new Headers()) },
      async () => {
        log.push('inner');
      },
    );
    expect(outcome).toEqual({ type: 'ok' });
    expect(log).toEqual([
      'a1:before',
      'a2:before',
      'c:before',
      'inner',
      'c:after',
      'a2:after',
      'a1:after',
    ]);
  });

  it('next() 를 부르지 않으면 자동으로 다음으로 넘어가고, params 는 각 라우트 것이다', async () => {
    const seen: unknown[] = [];
    const inner = vi.fn(async () => {});
    const { matches, modules, ...rest } = setup([
      { default: Page, middleware: ({ params }) => void seen.push(params.id) },
      { default: Page, middleware: ({ params }) => void seen.push(params.id) },
    ]);
    await runMiddleware(
      matches,
      modules,
      { ...rest, headers: [new Headers(), new Headers()] },
      inner,
    );
    expect(seen).toEqual(['0', '1']);
    expect(inner).toHaveBeenCalledOnce();
  });

  it('next() 를 두 번 부르면 에러', async () => {
    const { matches, modules, ...rest } = setup([
      {
        default: Page,
        middleware: async (_args, next) => {
          await next();
          await next();
        },
      },
    ]);
    const outcome = await runMiddleware(
      matches,
      modules,
      { ...rest, headers: [new Headers()] },
      async () => {},
    );
    expect(outcome).toMatchObject({ type: 'error', index: 0 });
  });

  it('바깥 미들웨어가 가드 에러를 삼켜도 inner 는 돌지 않고 실패로 본다', async () => {
    const inner = vi.fn(async () => {});
    const { matches, modules, ...rest } = setup([
      {
        default: Page,
        middleware: async (_args, next) => {
          try {
            await next();
          } catch {
            // 삼킴
          }
        },
      },
      { default: Page, middleware: () => redirect('/login') },
    ]);
    const outcome = await runMiddleware(
      matches,
      modules,
      { ...rest, headers: [new Headers(), new Headers()] },
      inner,
    );
    expect(inner).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ type: 'redirect', signal: { to: '/login' } });
  });

  it('inner 이후 에러를 바깥이 삼키면 성공', async () => {
    const { matches, modules, ...rest } = setup([
      {
        default: Page,
        middleware: async (_args, next) => {
          await next().catch(() => {});
        },
      },
      {
        default: Page,
        middleware: async (_args, next) => {
          await next();
          throw new Error('after');
        },
      },
    ]);
    const outcome = await runMiddleware(
      matches,
      modules,
      { ...rest, headers: [new Headers(), new Headers()] },
      async () => {},
    );
    expect(outcome).toEqual({ type: 'ok' });
  });
});

describe('runRoute', () => {
  it('미들웨어가 context 에 붙인 값을 로더가 본다', async () => {
    const result = await runRoute(
      setup([
        {
          default: Page,
          middleware: ({ context }) => {
            (context as Record<string, unknown>).user = 'kim';
          },
        },
        { default: Page, loader: ({ context }) => (context as { user: string }).user },
      ]),
    );
    expect(result).toMatchObject({ type: 'data', payload: { data: { r1: 'kim' }, status: 200 } });
  });

  it('미들웨어가 쓴 헤더는 같은 라우트 로더 헤더와 함께 §5.4 규칙으로 병합된다', async () => {
    const result = await runRoute(
      setup([
        {
          default: Page,
          middleware: ({ headers }) => {
            headers.append('set-cookie', 'mw=1');
            headers.set('x-a', 'mw');
          },
          loader: ({ headers }) => {
            headers.append('set-cookie', 'loader=1');
            return null;
          },
        },
      ]),
    );
    expect(result.headers.getSetCookie()).toEqual(['mw=1', 'loader=1']);
    expect(result.headers.get('x-a')).toBe('mw');
  });

  it('미들웨어 redirect 는 로더를 돌리지 않고 redirect 결과 (헤더 유지)', async () => {
    const loader = vi.fn(() => 'x');
    const result = await runRoute(
      setup([
        { default: Page, loader },
        {
          default: Page,
          middleware: ({ headers }) => {
            headers.append('set-cookie', 'next=/admin');
            redirect('/login', 303);
          },
          loader,
        },
      ]),
    );
    expect(loader).not.toHaveBeenCalled();
    expect(result).toMatchObject({ type: 'redirect', to: '/login', status: 303 });
    expect(result.headers.getSetCookie()).toEqual(['next=/admin']);
  });

  it('미들웨어 에러 → 그 라우트 이상 가장 가까운 ErrorBoundary, 위쪽 로더만 실행', async () => {
    const onError = vi.fn();
    const below = vi.fn(() => 'below');
    const boom = new Error('boom');
    const result = await runRoute({
      ...setup([
        { default: Page, ErrorBoundary: Boundary, loader: () => 'root' },
        {
          default: Page,
          middleware: () => {
            throw boom;
          },
          loader: below,
        },
        { default: Page, loader: below },
      ]),
      onError,
    });
    expect(below).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(boom, 'middleware');
    expect(result).toMatchObject({
      type: 'data',
      payload: {
        routes: ['r0', 'r1', 'r2'],
        data: { r0: 'root' },
        status: 500,
        error: { routeId: 'r0', error: { status: 500 } },
      },
    });
  });

  it('httpError 는 상태를 유지하고 onError 로 보고하지 않는다', async () => {
    const onError = vi.fn();
    const result = await runRoute({
      ...setup([{ default: Page, ErrorBoundary: Boundary, middleware: () => httpError(403) }]),
      onError,
    });
    expect(onError).not.toHaveBeenCalled();
    expect(result).toMatchObject({ payload: { status: 403, error: { routeId: 'r0' } } });
  });

  it('위쪽 로더가 실패하면 그 에러가 미들웨어 에러보다 우선한다', async () => {
    const result = await runRoute(
      setup([
        { default: Page, ErrorBoundary: Boundary, loader: () => httpError(401) },
        { default: Page, middleware: () => httpError(403) },
      ]),
    );
    expect(result).toMatchObject({ payload: { status: 401, routes: ['r0', 'r1'] } });
  });

  it('위쪽 로더 redirect 는 그대로 redirect', async () => {
    const result = await runRoute(
      setup([
        { default: Page, loader: () => redirect('/up') },
        { default: Page, middleware: () => httpError(403) },
      ]),
    );
    expect(result).toMatchObject({ type: 'redirect', to: '/up' });
  });

  it('next() 이후(로더 실행 뒤) 에러: 실패 지점 위쪽 데이터만 남긴다', async () => {
    const result = await runRoute(
      setup([
        { default: Page, loader: () => 'root' },
        {
          default: Page,
          middleware: async (_args, next) => {
            await next();
            throw httpError(409);
          },
          loader: () => 'child',
        },
      ]),
    );
    expect(result).toMatchObject({
      payload: { status: 409, data: { r0: 'root' }, error: { routeId: null } },
    });
    expect(result.type === 'data' && 'r1' in result.payload.data).toBe(false);
  });

  it('next() 이후 에러인데 더 위쪽 로더가 이미 실패했으면 로더 에러 우선', async () => {
    const result = await runRoute(
      setup([
        { default: Page, loader: () => httpError(401) },
        {
          default: Page,
          middleware: async (_args, next) => {
            await next();
            throw httpError(409);
          },
        },
      ]),
    );
    expect(result).toMatchObject({ payload: { status: 401 } });
  });

  it('미들웨어 총 시간(로더 제외)과 로더별 시간을 알린다', async () => {
    const onTiming = vi.fn();
    await runRoute({
      ...setup([
        { default: Page, middleware: () => {}, loader: () => 1 },
        { default: Page },
        { default: Page, loader: () => 2 },
      ]),
      onTiming,
    });
    const names = onTiming.mock.calls.map(([name]) => name);
    expect(names).toEqual(
      expect.arrayContaining(['middleware', { routeId: 'r0' }, { routeId: 'r2' }]),
    );
    expect(names).toHaveLength(3);
    for (const [, ms] of onTiming.mock.calls) expect(ms).toBeGreaterThanOrEqual(0);
  });

  it('미들웨어가 없으면 middleware 시간은 알리지 않는다', async () => {
    const onTiming = vi.fn();
    await runRoute({ ...setup([{ default: Page, loader: () => 1 }]), onTiming });
    expect(onTiming.mock.calls.map(([name]) => name)).toEqual([{ routeId: 'r0' }]);
  });
});
