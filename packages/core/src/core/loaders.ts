import { isRedirect, isReportable, toRouteError } from './errors';
import type { AppContext, RouteMatch, RouteModule, SsrPayload, SsrRequest } from './types';

export interface RunLoadersOptions {
  matches: RouteMatch[];
  modules: RouteModule[];
  request: SsrRequest;
  context: AppContext;
  signal: AbortSignal;
  dev: boolean;
  /** 의도되지 않은 로더 에러 보고 */
  onError?: (error: unknown) => void;
  /** 매치별 응답 헤더. 미들웨어와 같은 객체를 쓰려고 넘긴다. 생략 시 새로 만든다 */
  headerList?: Headers[];
  /** 로더별 실행 시간 (ms, 로더가 있는 매치만) */
  onLoaderTime?: (index: number, ms: number) => void;
}

export type LoaderResult =
  | { type: 'redirect'; to: string; status: number; headers: Headers }
  /** failedIndex: 실패한(가장 상위) 로더의 매치 index */
  | { type: 'data'; payload: SsrPayload; headers: Headers; failedIndex?: number };

const DEFAULT_CACHE_CONTROL = 'private, no-store';

/** 로더 데이터 안의 Promise 가 버려져도(redirect·에러) unhandled rejection 으로 프로세스를 죽이지 않게 */
const silencePromises = (value: unknown, seen = new Set<unknown>()) => {
  if (typeof value !== 'object' || value === null || seen.has(value)) return;
  seen.add(value);
  if (value instanceof Promise) {
    value.catch(() => {});
    return;
  }
  if (value instanceof Map) {
    for (const [key, child] of value) {
      silencePromises(key, seen);
      silencePromises(child, seen);
    }
    return;
  }
  if (value instanceof Set) {
    for (const child of value) silencePromises(child, seen);
    return;
  }
  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) return;
  for (const child of Object.values(value)) silencePromises(child, seen);
};

/** 루트 → 리프 순서로 덮어쓰기. Set-Cookie 는 전부 append */
export const mergeHeaders = (list: Headers[]): Headers => {
  const merged = new Headers();
  for (const headers of list) {
    for (const [key, value] of headers) {
      if (key !== 'set-cookie') merged.set(key, value);
    }
    for (const cookie of headers.getSetCookie()) merged.append('set-cookie', cookie);
  }
  if (!merged.has('cache-control')) merged.set('cache-control', DEFAULT_CACHE_CONTROL);
  return merged;
};

/** 실패한 매치 index 부터 위로 가장 가까운 ErrorBoundary 를 가진 라우트 */
export const findBoundary = (
  matches: RouteMatch[],
  modules: RouteModule[],
  failedIndex: number,
): string | null => {
  for (let i = failedIndex; i >= 0; i -= 1) {
    if (modules[i]?.ErrorBoundary) return matches[i]!.id;
  }
  return null;
};

const runOne = async (
  module: RouteModule,
  index: number,
  options: RunLoadersOptions,
  headers: Headers,
) => {
  if (!module.loader) return undefined;
  const start = performance.now();
  try {
    return await module.loader({
      params: options.matches[index]!.params,
      request: options.request,
      headers,
      signal: options.signal,
      context: options.context,
    });
  } finally {
    options.onLoaderTime?.(index, performance.now() - start);
  }
};

export const runLoaders = async (options: RunLoadersOptions): Promise<LoaderResult> => {
  const { matches, modules, dev } = options;
  const headerList = options.headerList ?? matches.map(() => new Headers());
  const results = await Promise.allSettled(
    // 다른 로더를 기다리는 동안 먼저 reject 된 데이터 Promise 가 unhandled 로 잡히지 않게 즉시 catch
    matches.map((_, i) =>
      runOne(modules[i]!, i, options, headerList[i]!).then((value) => {
        silencePromises(value);
        return value;
      }),
    ),
  );
  const headers = mergeHeaders(headerList);

  const redirectIndex = results.findIndex((r) => r.status === 'rejected' && isRedirect(r.reason));
  if (redirectIndex !== -1) {
    const signal = (results[redirectIndex] as PromiseRejectedResult).reason;
    return { type: 'redirect', to: signal.to, status: signal.status, headers };
  }

  const routes = matches.map((m) => m.id);
  const data: Record<string, unknown> = {};
  const failedIndex = results.findIndex((r) => r.status === 'rejected');
  const limit = failedIndex === -1 ? results.length : failedIndex;
  for (let i = 0; i < limit; i += 1) {
    data[routes[i]!] = (results[i] as PromiseFulfilledResult<unknown>).value;
  }

  if (failedIndex === -1) return { type: 'data', payload: { routes, data, status: 200 }, headers };

  const reason = (results[failedIndex] as PromiseRejectedResult).reason;
  if (isReportable(reason)) options.onError?.(reason);
  const error = toRouteError(reason, dev);
  return {
    type: 'data',
    payload: {
      routes,
      data,
      status: error.status,
      error: { routeId: findBoundary(matches, modules, failedIndex), error },
    },
    headers,
    failedIndex,
  };
};
