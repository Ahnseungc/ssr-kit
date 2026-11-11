import { PassThrough } from 'node:stream';

import { Suspense, use } from 'react';
import { describe, expect, it } from 'vitest';

import { deserialize } from '../src/core/serialize';
import type { RouteModule } from '../src/core/types';
import { DefaultDocument } from '../src/react/components';
import { useLoaderData } from '../src/react/hooks';
import type { ServerBuild } from '../src/server/build';
import { type HandleOptions,handleRequest } from '../src/server/request';

const later = <T,>(ms: number, value: T) => new Promise<T>((r) => setTimeout(() => r(value), ms));
const failLater = (ms: number) =>
  new Promise<never>((_, reject) => setTimeout(() => reject(new Error('차트 서버 다운')), ms));

const loader = () => ({
  title: '즉시',
  chart: later(30, { points: [1, 2, 3], at: new Date('2026-11-11T00:00:00Z') }),
  broken: failLater(10),
});

const Chart = ({ data }: { data: Promise<{ points: number[] }> }) => (
  <p id="chart">{use(data).points.join(',')}</p>
);

const Page = () => {
  const data = useLoaderData<typeof loader>();
  return (
    <main>
      <h1>{data.title}</h1>
      <Suspense fallback={<p id="chart-fallback">로딩</p>}>
        <Chart data={data.chart} />
      </Suspense>
    </main>
  );
};

const pageModule: RouteModule = { default: Page, loader };

const build: ServerBuild = {
  routes: [{ id: 'page', path: '/', module: () => Promise.resolve(pageModule) }],
  Document: DefaultDocument,
  dataPrefix: '/_data',
  dev: false,
  bootstrapModules: ['/entry.js'],
  resolveAssets: () => ({ modules: [], styles: [] }),
};

const request = (pathname: string) => ({
  url: new URL(pathname, 'http://localhost'),
  method: 'GET',
  headers: new Headers(),
  raw: null,
});

const run = async (pathname: string, options: Partial<HandleOptions> = {}) => {
  const stream = new PassThrough();
  const chunks: string[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));
  const ended = new Promise((r) => stream.on('end', r));
  let status = 0;
  await handleRequest(
    build,
    request(pathname),
    {
      writeHead: (s) => {
        status = s;
      },
      stream,
      signal: new AbortController().signal,
    },
    { isBot: false, renderTimeout: 1_000, unmatched: 'render', onError: () => {}, ...options },
  );
  await ended;
  return { status, chunks, html: chunks.join('') };
};

describe('Promise 스트리밍 (R2)', () => {
  it('셸을 먼저 보내고 resolve·reject 를 settle 스크립트로 이어 보낸다', async () => {
    const { html, chunks, status } = await run('/');
    expect(status).toBe(200);
    expect(chunks[0]).toContain('<h1>즉시</h1>');
    expect(chunks[0]).toContain('chart-fallback');
    expect(html).toContain('window.__SSRKQ=[]');
    expect(html).toMatch(/__SSRKR\(0,1,/);
    expect(html).toMatch(/__SSRKR\(1,0,/);
    expect(html).toContain('<p id="chart">1,2,3</p>');
    // prod 에서는 reject 메시지를 숨긴다
    expect(html).not.toContain('차트 서버 다운');
  });

  it('settle 스크립트는 React 청크 경계에만 끼운다', async () => {
    const { chunks } = await run('/');
    for (const chunk of chunks.filter((c) => c.includes('__SSRKR('))) {
      expect(chunk.startsWith('<script>')).toBe(true);
      expect(chunk.endsWith('</script>')).toBe(true);
    }
  });

  it('nonce 를 settle 스크립트에도 붙인다', async () => {
    const { html } = await run('/', { nonce: 'abc"x' });
    expect(html).toMatch(/<script nonce="abc&quot;x">__SSRKR/);
    expect(html).toContain('nonce="abc&quot;x"');
  });

  it('데이터 엔드포인트는 Promise 를 기다려 settle 된 Promise 로 보낸다', async () => {
    const { html, status } = await run('/_data/');
    expect(status).toBe(200);
    const body = JSON.parse(html) as { payload: unknown[] };
    const payload = deserialize<{ data: { page: ReturnType<typeof loader> } }>(body.payload);
    const page = payload.data.page;
    await expect(page.chart).resolves.toEqual({
      points: [1, 2, 3],
      at: new Date('2026-11-11T00:00:00Z'),
    });
    await expect(page.broken).rejects.toMatchObject({ status: 500 });
  });
});
