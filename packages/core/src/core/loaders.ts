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
}

export type LoaderResult =
  | { type: 'redirect'; to: string; status: number; headers: Headers }
  | { type: 'data'; payload: SsrPayload; headers: Headers };

const DEFAULT_CACHE_CONTROL = 'private, no-store';

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
  match: RouteMatch,
  options: RunLoadersOptions,
  headers: Headers,
) => {
  if (!module.loader) return undefined;
  return module.loader({
    params: match.params,
    request: options.request,
    headers,
    signal: options.signal,
    context: options.context,
  });
};

export const runLoaders = async (options: RunLoadersOptions): Promise<LoaderResult> => {
  const { matches, modules, dev } = options;
  const headerList = matches.map(() => new Headers());
  const results = await Promise.allSettled(
    matches.map((match, i) => runOne(modules[i]!, match, options, headerList[i]!)),
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
  };
};
