import { PassThrough } from 'node:stream';

import { Suspense, use } from 'react';
import { describe, expect, it } from 'vitest';

import { render } from '../src/server/render';
import { createNodeSink } from '../src/server/stream';

const later = <T,>(ms: number, value: T) => new Promise<T>((r) => setTimeout(() => r(value), ms));

const run = async (app: React.ReactNode, data: unknown, nonce?: string) => {
  const stream = new PassThrough();
  const chunks: string[] = [];
  stream.on('data', (c: Buffer) => chunks.push(c.toString()));
  const ended = new Promise((r) => stream.on('end', r));
  let status = 0;
  await render(
    {
      bootstrapModules: ['/entry.js'],
      resolveAssets: (files) => ({
        modules: files.map((f) => `/assets/${f}.js`),
        styles: ['/a.css'],
      }),
      dev: false,
    },
    {
      request: {
        url: new URL('http://localhost/x'),
        method: 'GET',
        headers: new Headers(),
        raw: null,
      },
      app,
      data,
      modules: ['page'],
      nonce,
    },
    createNodeSink({
      writeHead: (s) => (status = s),
      stream,
      signal: new AbortController().signal,
    }),
  );
  await ended;
  return { status, html: chunks.join('') };
};

const Slow = ({ value }: { value: Promise<string> }) => <b>{use(value)}</b>;

describe('render (RT6)', () => {
  it('외부 라우터 문서를 그대로 렌더하고 에셋·데이터를 붙인다', async () => {
    const value = later(20, '느린 값');
    const { status, html } = await run(
      <html>
        <head />
        <body>
          <Suspense fallback={<i>로딩</i>}>
            <Slow value={value} />
          </Suspense>
        </body>
      </html>,
      { user: 'kim', slow: value },
    );
    expect(status).toBe(200);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toMatch(/<link rel="modulepreload"[^>]*href="\/assets\/page.js"/);
    expect(html).toMatch(/<link rel="stylesheet" href="\/a.css"/);
    expect(html).toContain('window.__SSRK=');
    expect(html).toMatch(/__SSRKR\(0,1,/);
    expect(html).toContain('<b>느린 값</b>');
  });

  it('CSP nonce: 모든 인라인·모듈 스크립트에 nonce 가 붙는다', async () => {
    const value = later(10, 'x');
    const { html } = await run(
      <html>
        <head />
        <body>
          <Suspense fallback={<i>로딩</i>}>
            <Slow value={value} />
          </Suspense>
        </body>
      </html>,
      { slow: value },
      'n0nce',
    );
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts.length).toBeGreaterThanOrEqual(3);
    for (const tag of scripts) expect(tag).toContain('nonce="n0nce"');
  });

  it('셸 렌더 실패는 500 텍스트', async () => {
    const Broken = () => {
      throw new Error('셸 실패');
    };
    const { status, html } = await run(
      <html>
        <body>
          <Broken />
        </body>
      </html>,
      null,
    );
    expect(status).toBe(500);
    expect(html).toBe('Internal Server Error');
  });
});
