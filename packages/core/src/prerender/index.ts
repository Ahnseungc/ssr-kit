import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { PassThrough } from 'node:stream';
import { finished } from 'node:stream/promises';

import type { SsrRequest } from '../core/types';
import type { ServerBuild } from '../server/build';
import { type ErrorPhase, handleRequest, type RenderSink } from '../server/request';

export interface PrerenderOptions {
  build: ServerBuild;
  /** `/`, `/about` 처럼 경로만. 쿼리는 로더에 전달되지만 파일명에는 쓰지 않는다 */
  paths: string[];
  outDir: string;
  /** 로더가 보는 request.url 의 origin. 기본 http://localhost */
  origin?: string;
  onError?: (error: unknown, info: { url: string; phase: ErrorPhase }) => void;
}

export interface PrerenderResult {
  path: string;
  status: number;
  /** 200 일 때 쓴 파일 절대 경로 */
  file?: string;
  /** 3xx 일 때 Location */
  location?: string;
  /** 렌더 자체가 실패했을 때(status 500) */
  error?: unknown;
}

const DEFAULT_ORIGIN = 'http://localhost';
const CONCURRENCY = 4;
const RENDER_TIMEOUT_MS = 10_000;
const STATUS_OK = 200;
const STATUS_INTERNAL_ERROR = 500;
const INDEX_FILE = 'index.html';

interface Captured {
  status: number;
  headers: Headers;
  body: string;
}

/** 메모리에 모으는 싱크. 프리렌더는 끊길 연결이 없으므로 signal 은 abort 되지 않는다 */
const createMemorySink = () => {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  let head: { status: number; headers: Headers } | null = null;

  const sink: RenderSink = {
    writeHead(status, headers) {
      head = { status, headers };
    },
    stream,
    signal: new AbortController().signal,
  };

  const collect = async (): Promise<Captured> => {
    await finished(stream);
    if (!head) throw new Error('[ssr-kit] 응답 헤더 없이 스트림이 끝났습니다');
    const { status, headers } = head;
    return { status, headers, body: Buffer.concat(chunks).toString('utf8') };
  };

  return { sink, collect };
};

/** `/` → index.html, `/a/b` → a/b/index.html. outDir 밖으로 나가면 에러 */
export const outputFile = (outDir: string, pathname: string) => {
  const root = resolve(outDir);
  const segments = decodeURIComponent(pathname).split('/').filter(Boolean);
  const file = resolve(join(root, ...segments, INDEX_FILE));
  const rel = relative(root, file);
  if (rel.startsWith('..') || rel.split(sep).includes('..')) {
    throw new Error(`[ssr-kit] outDir 밖 경로는 프리렌더할 수 없습니다: ${pathname}`);
  }
  return file;
};

const renderPath = async (options: PrerenderOptions, path: string): Promise<PrerenderResult> => {
  const url = new URL(path, options.origin ?? DEFAULT_ORIGIN);
  const request: SsrRequest = { url, method: 'GET', headers: new Headers(), raw: null };
  const { sink, collect } = createMemorySink();

  await handleRequest(options.build, request, sink, {
    // 모든 Suspense 가 풀린 완성 HTML 을 얻기 위해 봇 모드로 렌더
    isBot: true,
    renderTimeout: RENDER_TIMEOUT_MS,
    unmatched: 'render',
    onError: options.onError,
  });
  const { status, headers, body } = await collect();

  const location = headers.get('location');
  if (location) return { path, status, location };
  if (status !== STATUS_OK) return { path, status };

  const file = outputFile(options.outDir, url.pathname);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, body);
  return { path, status, file };
};

/** 한 경로 실패가 전체를 멈추지 않도록 결과로 바꾼다 */
const safeRenderPath = async (options: PrerenderOptions, path: string) => {
  try {
    return await renderPath(options, path);
  } catch (error) {
    return { path, status: STATUS_INTERNAL_ERROR, error } satisfies PrerenderResult;
  }
};

/** 작업 순서를 유지하면서 동시에 limit 개까지만 실행 */
const mapLimit = async <T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) => {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
};

/** 프로덕션 빌드의 지정 경로를 정적 HTML 로 쓴다. 200 이 아닌 경로는 결과에만 남긴다 */
export const prerender = (options: PrerenderOptions): Promise<PrerenderResult[]> =>
  mapLimit(options.paths, CONCURRENCY, (path) => safeRenderPath(options, path));
