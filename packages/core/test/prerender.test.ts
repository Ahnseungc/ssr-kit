import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createElement, Suspense, use } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { notFound, redirect } from '../src/core/errors';
import type { RouteDef, RouteModule } from '../src/core/types';
import { outputFile, prerender } from '../src/prerender';
import { DefaultDocument } from '../src/react/components';
import { useLoaderData } from '../src/react/hooks';
import type { ServerBuild } from '../src/server/build';

const DEFERRED_MS = 30;

const Home = () => {
  const data = useLoaderData<() => { title: string }>();
  return createElement('h1', null, data.title);
};

const Post = () => {
  const data = useLoaderData<() => { slug: string }>();
  return createElement('p', null, `post:${data.slug}`);
};

let deferred: Promise<string>;
const Deferred = () => createElement('span', null, use(deferred));
const Slow = () =>
  createElement(
    Suspense,
    { fallback: createElement('i', null, 'loading') },
    createElement(Deferred),
  );

const route = (id: string, routePath: string, module: RouteModule): RouteDef => ({
  id,
  path: routePath,
  module: () => Promise.resolve(module),
});

const routes: RouteDef[] = [
  route('home', '/', { default: Home, loader: () => ({ title: 'hello-home' }) }),
  route('post', '/posts/:slug', {
    default: Post,
    loader: ({ params }) => ({ slug: params.slug }),
  }),
  route('slow', '/slow', { default: Slow }),
  route('old', '/old', {
    default: Home,
    loader: () => redirect('/'),
  }),
  route('gone', '/gone', {
    default: Home,
    loader: () => notFound(),
  }),
];

const build: ServerBuild = {
  routes,
  Document: DefaultDocument,
  dataPrefix: '/_data',
  dev: false,
  bootstrapModules: ['/assets/entry.js'],
  resolveAssets: () => ({ modules: [], styles: [] }),
};

let outDir: string;

beforeEach(() => {
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssrk-'));
  deferred = new Promise((r) => setTimeout(() => r('resolved-later'), DEFERRED_MS));
});

afterEach(() => {
  fs.rmSync(outDir, { recursive: true, force: true });
});

const read = (file: string) => fs.readFileSync(file, 'utf8');

describe('prerender', () => {
  it('200 경로를 <outDir>/<path>/index.html 로 쓰고 로더 데이터와 __SSRK 를 담는다', async () => {
    const results = await prerender({ build, paths: ['/', '/posts/a-b'], outDir });

    expect(results).toEqual([
      { path: '/', status: 200, file: path.join(outDir, 'index.html') },
      { path: '/posts/a-b', status: 200, file: path.join(outDir, 'posts/a-b/index.html') },
    ]);
    const home = read(path.join(outDir, 'index.html'));
    expect(home).toMatch(/^<!DOCTYPE html>/i);
    expect(home).toContain('<h1>hello-home</h1>');
    expect(home).toContain('window.__SSRK=');
    expect(home).toContain('hello-home');
    expect(home).toContain('/assets/entry.js');
    expect(read(path.join(outDir, 'posts/a-b/index.html'))).toContain('post:a-b');
  });

  it('Suspense 안의 use(promise) 가 모두 풀린 HTML 을 쓴다', async () => {
    const [result] = await prerender({ build, paths: ['/slow'], outDir });
    const html = read(result!.file!);
    expect(html).toContain('<span>resolved-later</span>');
    expect(html).not.toContain('loading');
  });

  it('redirect 는 location 만 기록하고 파일을 쓰지 않는다', async () => {
    const [result] = await prerender({ build, paths: ['/old'], outDir });
    expect(result).toMatchObject({ path: '/old', location: '/' });
    expect(result!.status).toBeGreaterThanOrEqual(300);
    expect(result!.status).toBeLessThan(400);
    expect(result!.file).toBeUndefined();
    expect(fs.readdirSync(outDir)).toEqual([]);
  });

  it('notFound·매치 없음은 404 로 기록하고 파일을 쓰지 않는다', async () => {
    const results = await prerender({ build, paths: ['/gone', '/nope'], outDir });
    expect(results).toEqual([
      { path: '/gone', status: 404 },
      { path: '/nope', status: 404 },
    ]);
    expect(fs.readdirSync(outDir)).toEqual([]);
  });

  it('동시성 제한을 넘는 경로도 순서대로 결과를 돌려준다', async () => {
    const paths = Array.from({ length: 9 }, (_, i) => `/posts/p${i}`);
    const results = await prerender({ build, paths, outDir });
    expect(results.map((r) => r.path)).toEqual(paths);
    expect(results.every((r) => r.status === 200)).toBe(true);
  });
});

describe('outputFile', () => {
  it('outDir 밖으로 나가는 경로는 거부한다', () => {
    expect(() => outputFile('/out', '/%2e%2e/etc')).toThrow(/outDir/);
    expect(outputFile('/out', '/a/b/')).toBe(path.join('/out', 'a/b/index.html'));
  });
});
