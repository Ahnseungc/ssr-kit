import { PassThrough } from 'node:stream';

import { Suspense, use } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { RouteModule } from '../src/core/types';
import { DefaultDocument, Outlet } from '../src/react/components';
import { useLoaderData } from '../src/react/hooks';
import type { ServerBuild } from '../src/server/build';
import { handleRequest } from '../src/server/request';
import { createNodeSink } from '../src/server/stream';

class Money {
  constructor(readonly amount: number) {}
}

const later = <T,>(ms: number, value: T) => new Promise<T>((r) => setTimeout(() => r(value), ms));
const Wait = ({ value }: { value: Promise<unknown> }) => <b>{String(use(value))}</b>;

const Deferred = () => {
  const { slow } = useLoaderData<() => { slow: Promise<string> }>();
  return (
    <Suspense fallback={<i>로딩</i>}>
      <Wait value={slow} />
    </Suspense>
  );
};

const modules: Record<string, RouteModule> = {
  root: {
    default: () => <Outlet />,
    loader: ({ headers }) => {
      headers.set('cache-control', 'public, max-age=3600');
      return {};
    },
  },
  money: {
    default: Deferred,
    loader: () => ({ money: later(5, new Money(1)), slow: later(40, 'ok') }),
  },
  hang: { default: () => null, loader: () => ({ never: new Promise(() => {}) }) },
  fail: {
    default: () => null,
    ErrorBoundary: () => <p>에러</p>,
    loader: () => {
      throw new Error('실패');
    },
  },
};

const build: ServerBuild = {
  routes: [
    {
      id: 'root',
      module: () => Promise.resolve(modules.root!),
      children: ['money', 'hang', 'fail'].map((id) => ({
        id,
        path: id,
        module: () => Promise.resolve(modules[id]!),
      })),
    },
  ],
  Document: DefaultDocument,
  dataPrefix: '/_data',
  dev: false,
  bootstrapModules: [],
  resolveAssets: () => ({ modules: [], styles: [] }),
};

const run = async (pathname: string, onError = vi.fn()) => {
  const stream = new PassThrough();
  let body = '';
  stream.on('data', (c: Buffer) => (body += c.toString()));
  const ended = new Promise((r) => stream.on('end', r));
  let status = 0;
  let headers = new Headers();
  await handleRequest(
    build,
    {
      url: new URL(pathname, 'http://localhost'),
      method: 'GET',
      headers: new Headers(),
      raw: null,
    },
    createNodeSink({
      writeHead: (s, h) => {
        status = s;
        headers = h;
      },
      stream,
      signal: new AbortController().signal,
    }),
    { isBot: false, renderTimeout: 150, unmatched: 'render', onError },
  );
  await ended;
  return { status, headers, body, onError };
};

describe('서버 회귀 (리뷰 지적)', () => {
  it('직렬화할 수 없는 deferred 값은 응답을 끊지 않고 reject 로 보내고 onError 로 보고한다', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const { body, onError } = await run('/money');
      expect(body).toMatch(/__SSRKR\(0,0,/);
      expect(body).toMatch(/__SSRKR\(1,1,/);
      expect(body).toContain('<b>ok</b>');
      expect(onError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ phase: 'stream' }),
      );
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('데이터 엔드포인트도 renderTimeout 안에 응답하고 끝나지 않는 Promise 를 reject 로 보낸다', async () => {
    const started = Date.now();
    const { status, body, onError } = await run('/_data/hang');
    expect(status).toBe(200);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(body).toContain('"p",0');
    expect(onError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ phase: 'data' }),
    );
  });

  it('에러 응답은 로더의 public 캐시를 물려받지 않는다', async () => {
    const doc = await run('/fail');
    expect(doc.status).toBe(500);
    expect(doc.headers.get('cache-control')).toBe('no-store');
    const data = await run('/_data/fail');
    expect(data.headers.get('cache-control')).toBe('no-store');
    const ok = await run('/money');
    expect(ok.headers.get('cache-control')).toBe('public, max-age=3600');
  });
});
