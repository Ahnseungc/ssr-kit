import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { PassThrough } from 'node:stream';
import { finished } from 'node:stream/promises';

import type { SsrRequest } from '../core/types';
import type { ServerBuild } from '../server/build';
import { type ErrorPhase, handleRequest } from '../server/request';
import { createNodeSink } from '../server/stream';

export interface PrerenderOptions {
  build: ServerBuild;
  /** `/`, `/about` 처럼 경로만. 쿼리는 로더에 전달되지만 파일명에는 쓰지 않는다 */
  paths: string[];
  outDir: string;
  /** 로더가 보는 request.url 의 origin. 기본 http://localhost */
  origin?: string;
  /**
   * 클라 이동용 데이터 JSON 도 쓴다 (기본 true): `<outDir><dataPrefix><path>/index.json`.
   * 정적 호스팅에서는 `<dataPrefix>/:path` 를 `<dataPrefix>/:path/index.json` 으로 rewrite 해야 한다.
   */
  data?: boolean;
  onError?: (error: unknown, info: { url: string; phase: ErrorPhase }) => void;
}

export interface PrerenderResult {
  path: string;
  status: number;
  /** 200 일 때 쓴 파일 절대 경로 */
  file?: string;
  /** 데이터 JSON 을 썼을 때 그 절대 경로 */
  dataFile?: string;
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
const DATA_FILE = 'index.json';

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

  const sink = createNodeSink({
    writeHead(status, headers) {
      head = { status, headers };
    },
    stream,
    signal: new AbortController().signal,
  });

  const collect = async (): Promise<Captured> => {
    await finished(stream);
    if (!head) throw new Error('[ssr-kit] 응답 헤더 없이 스트림이 끝났습니다');
    const { status, headers } = head;
    return { status, headers, body: Buffer.concat(chunks).toString('utf8') };
  };

  return { sink, collect };
};

/** `/` → index.html, `/a/b` → a/b/index.html. outDir 밖으로 나가면 에러 */
export const outputFile = (outDir: string, pathname: string, fileName = INDEX_FILE) => {
  const root = resolve(outDir);
  const segments = decodeURIComponent(pathname).split('/').filter(Boolean);
  const file = resolve(join(root, ...segments, fileName));
  const rel = relative(root, file);
  if (rel.startsWith('..') || rel.split(sep).includes('..')) {
    throw new Error(`[ssr-kit] outDir 밖 경로는 프리렌더할 수 없습니다: ${pathname}`);
  }
  return file;
};

const capture = async (options: PrerenderOptions, url: URL) => {
  const request: SsrRequest = { url, method: 'GET', headers: new Headers(), raw: null };
  const { sink, collect } = createMemorySink();
  await handleRequest(options.build, request, sink, {
    // 모든 Suspense 가 풀린 완성 HTML 을 얻기 위해 봇 모드로 렌더
    isBot: true,
    renderTimeout: RENDER_TIMEOUT_MS,
    unmatched: 'render',
    onError: options.onError,
  });
  return collect();
};

const write = async (file: string, body: string) => {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, body);
  return file;
};

/** 데이터 엔드포인트 응답을 JSON 으로 쓴다. redirect 응답(type: 'redirect')도 200 이라 함께 쓴다 */
const writeData = async (options: PrerenderOptions, url: URL) => {
  const { dataPrefix } = options.build;
  const dataUrl = new URL(`${dataPrefix}${url.pathname}${url.search}`, url);
  const { status, body } = await capture(options, dataUrl);
  if (status !== STATUS_OK) return undefined;
  return write(outputFile(options.outDir, `${dataPrefix}${url.pathname}`, DATA_FILE), body);
};

const renderPath = async (options: PrerenderOptions, path: string): Promise<PrerenderResult> => {
  const url = new URL(path, options.origin ?? DEFAULT_ORIGIN);
  const { status, headers, body } = await capture(options, url);
  const dataFile = options.data === false ? undefined : await writeData(options, url);
  const withData = dataFile ? { dataFile } : {};

  const location = headers.get('location');
  if (location) return { path, status, location, ...withData };
  if (status !== STATUS_OK) return { path, status };

  const file = await write(outputFile(options.outDir, url.pathname), body);
  return { path, status, file, ...withData };
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
