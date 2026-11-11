import { describe, expect, it, vi } from 'vitest';

import { httpError, notFound, redirect } from '../src/core/errors';
import { mergeHead } from '../src/core/head';
import { mergeHeaders, runLoaders } from '../src/core/loaders';
import type { RouteMatch, RouteModule } from '../src/core/types';

const Page = () => null;
const Boundary = () => null;

const setup = (modules: RouteModule[]) => {
  const matches: RouteMatch[] = modules.map((_, i) => ({
    id: `r${i}`,
    route: { module: () => Promise.resolve(modules[i]!) },
    params: { id: '1' },
  }));
  const request = {
    url: new URL('http://localhost/x'),
    method: 'GET',
    headers: new Headers(),
    raw: null,
  };
  return { matches, modules, request, context: {}, signal: new AbortController().signal };
};

describe('runLoaders', () => {
  it('로더를 병렬로 실행하고 route id 별 데이터를 모은다', async () => {
    const order: string[] = [];
    const slow = async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push('slow');
      return 'a';
    };
    const fast = async () => {
      order.push('fast');
      return 'b';
    };
    const result = await runLoaders({
      ...setup([
        { default: Page, loader: slow },
        { default: Page },
        { default: Page, loader: fast },
      ]),
      dev: false,
    });
    expect(order).toEqual(['fast', 'slow']);
    expect(result).toMatchObject({
      type: 'data',
      payload: {
        routes: ['r0', 'r1', 'r2'],
        data: { r0: 'a', r1: undefined, r2: 'b' },
        status: 200,
      },
    });
  });

  it('params·headers 를 넘기고 깊은 라우트 헤더가 이긴다, Set-Cookie 는 누적', async () => {
    const result = await runLoaders({
      ...setup([
        {
          default: Page,
          loader: ({ headers }) => {
            headers.set('cache-control', 'public, max-age=60');
            headers.append('set-cookie', 'a=1');
          },
        },
        {
          default: Page,
          loader: ({ headers, params }) => {
            headers.set('cache-control', 'private');
            headers.append('set-cookie', 'b=2');
            return params;
          },
        },
      ]),
      dev: false,
    });
    expect(result.headers.get('cache-control')).toBe('private');
    expect(result.headers.getSetCookie()).toEqual(['a=1', 'b=2']);
    expect(result.type === 'data' && result.payload.data.r1).toEqual({ id: '1' });
  });

  it('Cache-Control 이 없으면 private, no-store', () => {
    expect(mergeHeaders([new Headers()]).get('cache-control')).toBe('private, no-store');
  });

  it('redirect 는 가장 상위 매치 기준', async () => {
    const result = await runLoaders({
      ...setup([
        { default: Page, loader: () => redirect('/login', 303) },
        { default: Page, loader: () => redirect('/other') },
      ]),
      dev: false,
    });
    expect(result).toMatchObject({ type: 'redirect', to: '/login', status: 303 });
  });

  it('에러는 가장 가까운 상위 ErrorBoundary 로, 실패 아래 데이터는 버린다', async () => {
    const onError = vi.fn();
    const result = await runLoaders({
      ...setup([
        { default: Page, ErrorBoundary: Boundary, loader: () => 'root' },
        { default: Page, loader: () => notFound() },
        { default: Page, loader: () => 'leaf' },
      ]),
      dev: false,
      onError,
    });
    expect(result).toMatchObject({
      type: 'data',
      payload: {
        status: 404,
        data: { r0: 'root' },
        error: { routeId: 'r0', error: { status: 404, message: 'Not Found' } },
      },
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it('일반 Error 는 500, prod 에선 메시지 숨김, onError 보고', async () => {
    const onError = vi.fn();
    const result = await runLoaders({
      ...setup([{ default: Page, loader: () => Promise.reject(new Error('DB 비밀번호 틀림')) }]),
      dev: false,
      onError,
    });
    expect(result).toMatchObject({
      payload: {
        status: 500,
        error: { routeId: null, error: { status: 500, message: 'Internal Server Error' } },
      },
    });
    expect(onError).toHaveBeenCalledOnce();
  });

  it('dev 에선 메시지·스택을 보낸다, httpError 의 명시 메시지는 prod 에서도 유지', async () => {
    const dev = await runLoaders({
      ...setup([{ default: Page, loader: () => Promise.reject(new Error('원인')) }]),
      dev: true,
    });
    expect(dev.type === 'data' && dev.payload.error?.error).toMatchObject({
      message: '원인',
      stack: expect.any(String),
    });

    const prod = await runLoaders({
      ...setup([{ default: Page, loader: () => httpError(403, '권한 없음') }]),
      dev: false,
    });
    expect(prod.type === 'data' && prod.payload.error?.error).toEqual({
      status: 403,
      message: '권한 없음',
    });
  });
});

describe('mergeHead', () => {
  it('title 은 마지막, meta 는 키 기준 깊은 쪽, link 는 중복 제거', () => {
    expect(
      mergeHead([
        {
          title: 'root',
          meta: [
            { name: 'description', content: 'a' },
            { property: 'og:title', content: 'r' },
          ],
          link: [{ rel: 'icon', href: '/a.png' }],
        },
        {
          title: 'leaf',
          meta: [{ name: 'description', content: 'b' }],
          link: [
            { rel: 'icon', href: '/a.png' },
            { rel: 'canonical', href: '/x' },
          ],
        },
      ]),
    ).toEqual({
      title: 'leaf',
      meta: [
        { property: 'og:title', content: 'r' },
        { name: 'description', content: 'b' },
      ],
      link: [
        { rel: 'icon', href: '/a.png' },
        { rel: 'canonical', href: '/x' },
      ],
    });
  });
});
