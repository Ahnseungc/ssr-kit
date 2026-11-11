import { createHash } from 'node:crypto';
import { PassThrough } from 'node:stream';

import { cspHashes } from '@vitejs/plugin-legacy';
import { Suspense, use } from 'react';
import { describe, expect, it } from 'vitest';

import type { RouteModule } from '../src/core/types';
import { createEdgeHandler } from '../src/edge/index';
import { DefaultDocument } from '../src/react/components';
import { useLoaderData } from '../src/react/hooks';
import { createTailHtml, type ServerBuild } from '../src/server/build';
import { render } from '../src/server/render';
import { type HandleOptions, handleRequest } from '../src/server/request';
import { createNodeSink } from '../src/server/stream';
import { findLegacyAssets, LEGACY_INLINE_SCRIPTS, legacyTailParts } from '../src/vite/legacy';

const TAIL = '<script data-tail></script>';
const later = <T,>(ms: number, value: T) => new Promise<T>((r) => setTimeout(() => r(value), ms));

describe('plugin-legacy 스니펫 미러', () => {
  it('인라인 코드가 설치된 @vitejs/plugin-legacy 의 cspHashes 와 같다', () => {
    const hashes = LEGACY_INLINE_SCRIPTS.map((code) =>
      createHash('sha256').update(code).digest('base64'),
    );
    expect(hashes).toEqual(cspHashes);
  });

  it('base 를 붙이고 요청 nonce 를 모든 태그에 (escape 해서) 적용한다', () => {
    const tail = createTailHtml(
      legacyTailParts(
        { entry: 'assets/entry-legacy.js', polyfills: 'assets/p-legacy.js' },
        '/cdn/',
      ),
    );
    const plain = tail();
    expect(plain).toContain(
      '<script nomodule crossorigin id="vite-legacy-polyfill" src="/cdn/assets/p-legacy.js"></script>',
    );
    expect(plain).toContain('id="vite-legacy-entry" data-src="/cdn/assets/entry-legacy.js"');
    expect(plain).not.toContain('nonce');
    expect(plain.match(/<script/g)).toHaveLength(5);

    const withNonce = tail('n"1');
    expect(withNonce.match(/<script nonce="n&quot;1"/g)).toHaveLength(5);
  });

  it('폴리필 청크가 없으면 감지·폴백 스크립트를 넣지 않는다 (plugin-legacy 와 같게)', () => {
    const html = createTailHtml(legacyTailParts({ entry: 'e-legacy.js' }, '/'))();
    expect(html).toContain('data-src="/e-legacy.js"');
    expect(html).not.toContain('vite-legacy-polyfill"');
    expect(html).not.toContain('<script type="module"');
  });

  it('매니페스트에서 레거시 엔트리·폴리필을 찾고, 모던 엔트리가 없으면 실패한다', () => {
    const entry = { file: 'a.js', isEntry: true };
    const manifest = {
      app: entry,
      'app-legacy': { file: 'a-legacy.js', isEntry: true },
      'vite/legacy-polyfills-legacy': { file: 'p-legacy.js', isEntry: true },
      'vite/legacy-polyfills': { file: 'p.js', isEntry: true },
    };
    expect(findLegacyAssets(manifest, 'app')).toEqual({
      entry: 'a-legacy.js',
      polyfills: 'p-legacy.js',
      modernPolyfills: 'p.js',
    });
    expect(() => findLegacyAssets({ 'app-legacy': entry }, 'app')).toThrow(/renderModernChunks/);
    expect(() => findLegacyAssets({ app: entry }, 'app')).toThrow(/레거시 엔트리/);
  });
});

const loader = () => ({ title: '레거시', slow: later(50, 'slow') });
const Slow = ({ value }: { value: Promise<string> }) => <b id="slow">{use(value)}</b>;
const Page = () => {
  const data = useLoaderData<typeof loader>();
  return (
    <main>
      <h1>{data.title}</h1>
      <Suspense fallback={<i>로딩</i>}>
        <Slow value={data.slow} />
      </Suspense>
    </main>
  );
};
const PromiseOnly = () => <h1>데이터만 느림</h1>;

const modules: Record<string, RouteModule> = {
  page: { default: Page, loader },
  // React 는 바로 끝나고 Promise 만 남는다 → tail 이 settle 스크립트보다 먼저
  pending: { default: PromiseOnly, loader: () => ({ late: later(50, 1) }) },
};

const makeBuild = (tailHtml?: ServerBuild['tailHtml']): ServerBuild => ({
  routes: Object.keys(modules).map((id) => ({
    id,
    path: `/${id}`,
    module: () => Promise.resolve(modules[id]!),
  })),
  Document: DefaultDocument,
  dataPrefix: '/_data',
  dev: false,
  bootstrapModules: ['/entry.js'],
  resolveAssets: () => ({ modules: [], styles: [] }),
  tailHtml,
});

const tailFn: ServerBuild['tailHtml'] = (nonce) =>
  nonce ? `<script nonce="${nonce}" data-tail></script>` : TAIL;

const runNode = async (
  build: ServerBuild,
  pathname: string,
  options: Partial<HandleOptions> = {},
) => {
  const stream = new PassThrough();
  const chunks: string[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));
  const ended = new Promise((r) => stream.on('end', r));
  await handleRequest(
    build,
    {
      url: new URL(pathname, 'http://localhost'),
      method: 'GET',
      headers: new Headers(),
      raw: null,
    },
    createNodeSink({ writeHead: () => {}, stream, signal: new AbortController().signal }),
    { isBot: false, renderTimeout: 1_000, unmatched: 'render', onError: () => {}, ...options },
  );
  await ended;
  return chunks.join('');
};

const runNodeHead = async (build: ServerBuild) => {
  const stream = new PassThrough();
  const chunks: string[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));
  const ended = new Promise((r) => stream.on('end', r));
  await handleRequest(
    build,
    {
      url: new URL('/page', 'http://localhost'),
      method: 'HEAD',
      headers: new Headers(),
      raw: null,
    },
    createNodeSink({ writeHead: () => {}, stream, signal: new AbortController().signal }),
    { isBot: false, renderTimeout: 1_000, unmatched: 'render', onError: () => {} },
  );
  await ended;
  return chunks.join('');
};

const expectTailOnceAfterReact = (html: string, tail = TAIL) => {
  expect(html.split(tail)).toHaveLength(2);
  expect(html.indexOf(tail)).toBeGreaterThan(html.lastIndexOf('</html>'));
};

describe('tailHtml: Node 렌더러', () => {
  it('React 출력이 끝난 뒤 한 번 붙인다 (Suspense 완료 후)', async () => {
    const html = await runNode(makeBuild(tailFn), '/page');
    expect(html).toContain('<b id="slow">slow</b>');
    expectTailOnceAfterReact(html);
    expect(html.indexOf(TAIL)).toBeGreaterThan(html.indexOf('<b id="slow">'));
  });

  it('남은 Promise 의 settle 스크립트보다 먼저 붙인다', async () => {
    const html = await runNode(makeBuild(tailFn), '/pending');
    expectTailOnceAfterReact(html);
    expect(html.indexOf(TAIL)).toBeLessThan(html.indexOf('__SSRKR(0,1,'));
  });

  it('요청 nonce 로 만든다', async () => {
    const html = await runNode(makeBuild(tailFn), '/page', { nonce: 'n1' });
    expectTailOnceAfterReact(html, '<script nonce="n1" data-tail></script>');
  });

  it('봇 모드에서도 한 번', async () => {
    expectTailOnceAfterReact(await runNode(makeBuild(tailFn), '/page', { isBot: true }));
  });

  it('tailHtml 이 없으면 아무것도 붙이지 않는다', async () => {
    const html = await runNode(makeBuild(), '/page');
    expect(html).not.toContain('data-tail');
    expect(html.slice(html.lastIndexOf('</html>') + '</html>'.length)).toBe('');
  });

  it('HEAD 응답에는 붙이지 않는다', async () => {
    expect(await runNodeHead(makeBuild(tailFn))).toBe('');
  });

  it('render() (RT6) 도 tailHtml 을 붙인다', async () => {
    const stream = new PassThrough();
    const chunks: string[] = [];
    stream.on('data', (c: Buffer) => chunks.push(c.toString()));
    const ended = new Promise((r) => stream.on('end', r));
    await render(
      { ...makeBuild(tailFn) },
      {
        request: {
          url: new URL('http://localhost/x'),
          method: 'GET',
          headers: new Headers(),
          raw: null,
        },
        app: (
          <html lang="ko">
            <body>
              <p>외부</p>
            </body>
          </html>
        ),
        nonce: 'r1',
      },
      createNodeSink({ writeHead: () => {}, stream, signal: new AbortController().signal }),
    );
    await ended;
    expectTailOnceAfterReact(chunks.join(''), '<script nonce="r1" data-tail></script>');
  });
});

describe('tailHtml: edge 렌더러', () => {
  const get = async (build: ServerBuild, pathname: string, init?: RequestInit, nonce?: string) => {
    const handle = createEdgeHandler({ build, onError: () => {}, getNonce: () => nonce });
    return (await handle(new Request(`http://localhost${pathname}`, init)))!;
  };

  it('React 출력 끝에 한 번, 남은 settle 스크립트보다 먼저 붙인다', async () => {
    const html = await (await get(makeBuild(tailFn), '/page')).text();
    expect(html).toContain('<b id="slow">slow</b>');
    expectTailOnceAfterReact(html);

    const pending = await (await get(makeBuild(tailFn), '/pending')).text();
    expectTailOnceAfterReact(pending);
    expect(pending.indexOf(TAIL)).toBeLessThan(pending.indexOf('__SSRKR(0,1,'));
  });

  it('nonce 적용, HEAD·tailHtml 없음에는 붙이지 않는다', async () => {
    const html = await (await get(makeBuild(tailFn), '/page', undefined, 'e1')).text();
    expectTailOnceAfterReact(html, '<script nonce="e1" data-tail></script>');
    expect(await (await get(makeBuild(tailFn), '/page', { method: 'HEAD' })).text()).toBe('');
    expect(await (await get(makeBuild(), '/page')).text()).not.toContain('data-tail');
  });
});
