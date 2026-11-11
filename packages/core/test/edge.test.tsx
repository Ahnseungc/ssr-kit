import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { Suspense, use } from 'react';
import { describe, expect, it } from 'vitest';

import { notFound, redirect } from '../src/core/errors';
import { deserialize } from '../src/core/serialize';
import type { RouteModule, SsrPayload } from '../src/core/types';
import { createEdgeHandler } from '../src/edge/index';
import { DefaultDocument } from '../src/react/components';
import { useActionData, useLoaderData } from '../src/react/hooks';
import type { ServerBuild } from '../src/server/build';

const later = <T,>(ms: number, value: T) => new Promise<T>((r) => setTimeout(() => r(value), ms));

const loader = () => ({ title: '엣지', slow: later(30, { n: 42 }) });

const Slow = ({ value }: { value: Promise<{ n: number }> }) => <b id="slow">{use(value).n}</b>;

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

const Broken = () => {
  throw new Error('셸 실패');
};

const modules: Record<string, RouteModule> = {
  page: { default: Page, loader },
  missing: { default: Page, loader: () => notFound() },
  old: { default: Page, loader: () => redirect('/page', 308) },
  broken: { default: Broken },
  form: {
    default: () => <p id="form">{String(useActionData<() => { n: number }>()?.n)}</p>,
    action: async ({ request }) => ({ n: (await request.json<{ n: number }>()).n * 2 }),
  },
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
  bootstrapModules: ['/entry.js'],
  resolveAssets: () => ({ modules: [], styles: [] }),
};

const handle = createEdgeHandler({ build, onError: () => {} });
const get = (p: string, init?: RequestInit) => handle(new Request(`http://localhost${p}`, init));

describe('createEdgeHandler (Web 스트림)', () => {
  it('셸을 스트리밍하고 Suspense 를 채운 뒤 settle 스크립트를 끝에 붙인다', async () => {
    const response = (await get('/page'))!;
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<h1>엣지</h1>');
    expect(html).toContain('<b id="slow">42</b>');
    const settleAt = html.indexOf('__SSRKR(0,1,');
    expect(settleAt).toBeGreaterThan(html.lastIndexOf('</html>'));
  });

  it('스트리밍 문서는 런타임 압축을 끄고(identity), 봇 응답·직접 정한 인코딩은 그대로 둔다', async () => {
    const streamed = (await get('/page'))!;
    expect(streamed.headers.get('content-encoding')).toBe('identity');
    await streamed.text();
    const bot = (await handle(
      new Request('http://localhost/page', { headers: { 'user-agent': 'Googlebot/2.1' } }),
    ))!;
    expect(bot.headers.get('content-encoding')).toBeNull();
    await bot.text();
  });

  it('404·redirect·데이터·HEAD·405', async () => {
    expect((await get('/missing'))!.status).toBe(404);
    const redirected = (await get('/old'))!;
    expect(redirected.status).toBe(308);
    expect(redirected.headers.get('location')).toBe('/page');
    const data = (await get('/_data/page'))!;
    expect(await data.json()).toMatchObject({ type: 'data' });
    const head = (await get('/page', { method: 'HEAD' }))!;
    expect(head.body).toBeNull();
    expect((await get('/page', { method: 'POST' }))!.status).toBe(405);
  });

  it('action: JSON 본문을 읽어 데이터 엔드포인트로 돌려준다', async () => {
    const response = (await get('/_data/form', {
      method: 'POST',
      body: JSON.stringify({ n: 21 }),
      headers: { origin: 'http://localhost', 'content-type': 'application/json' },
    }))!;
    expect(response.status).toBe(200);
    const body = (await response.json()) as { payload: unknown[] };
    expect(deserialize<SsrPayload>(body.payload).actionData).toEqual({ n: 42 });
  });

  it('셸 렌더 실패는 루트 에러 문서 500', async () => {
    const response = (await get('/broken'))!;
    expect(response.status).toBe(500);
    expect(await response.text()).toContain('Internal Server Error');
  });

  it('edge 모듈 그래프에 node:* import 가 없다 (Workers 호환)', () => {
    const src = path.join(import.meta.dirname, '../src');
    const seen = new Set<string>();
    const nodeImports: string[] = [];
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const code = readFileSync(file, 'utf8');
      for (const [, spec] of code.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)) {
        if (spec.startsWith('node:')) nodeImports.push(`${path.relative(src, file)} → ${spec}`);
        if (!spec.startsWith('.')) continue;
        const base = path.resolve(path.dirname(file), spec);
        const next = ['.ts', '.tsx', '/index.ts', '/index.tsx']
          .map((ext) => base + ext)
          .find(existsSync);
        if (next) visit(next);
      }
    };
    visit(path.join(src, 'edge/index.tsx'));
    expect(nodeImports).toEqual([]);
    expect(seen.size).toBeGreaterThan(5);
  });
});
