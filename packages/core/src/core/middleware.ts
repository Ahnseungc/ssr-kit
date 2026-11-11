import { isRedirect, isReportable, type RedirectSignal, toRouteError } from './errors';
import {
  findBoundary,
  type LoaderResult,
  mergeHeaders,
  runLoaders,
  type RunLoadersOptions,
} from './loaders';
import type { Middleware, MiddlewareArgs, RouteMatch, RouteModule } from './types';

/** params·headers 는 라우트마다 정해지므로 공통 인자에서 뺀다 */
export type MiddlewareBaseArgs = Omit<MiddlewareArgs, 'params' | 'headers'>;

export type MiddlewareOutcome =
  | { type: 'ok' }
  | { type: 'redirect'; signal: RedirectSignal }
  /** index: 실패한 미들웨어의 매치 index */
  | { type: 'error'; index: number; error: unknown };

const toList = (middleware: RouteModule['middleware']): Middleware[] => {
  if (!middleware) return [];
  return Array.isArray(middleware) ? middleware : [middleware];
};

interface Step {
  index: number;
  fn: Middleware;
}

/**
 * 매치된 라우트들의 미들웨어를 루트 → 리프 순서로 onion 실행하고, 맨 안쪽에서 inner 를 부른다.
 * next() 없이 끝난 미들웨어는 자동으로 다음으로 넘어간다.
 * 미들웨어가 throw 하면 inner 를 부르지 않는다 — 바깥 미들웨어가 삼켜도 inner 가 안 돌았으면 실패로 본다.
 */
export const runMiddleware = async (
  matches: RouteMatch[],
  modules: RouteModule[],
  args: MiddlewareBaseArgs & { headers: Headers[] },
  inner: () => Promise<void>,
): Promise<MiddlewareOutcome> => {
  const steps: Step[] = matches.flatMap((_, index) =>
    toList(modules[index]?.middleware).map((fn) => ({ index, fn })),
  );
  let innerCalled = false;
  let failure: { index: number; error: unknown } | undefined;

  const dispatch = async (position: number): Promise<void> => {
    if (position === steps.length) {
      innerCalled = true;
      return inner();
    }
    const { index, fn } = steps[position]!;
    let called = false;
    const next = () => {
      if (called) return Promise.reject(new Error('middleware next() can only be called once'));
      called = true;
      return dispatch(position + 1);
    };
    try {
      await fn({ ...args, params: matches[index]!.params, headers: args.headers[index]! }, next);
      if (!called) await next();
    } catch (error) {
      // 안쪽에서 올라온 같은 에러면 원래(가장 안쪽) 위치를 유지
      if (failure?.error !== error) failure = { index, error };
      throw error;
    }
  };

  try {
    await dispatch(0);
    // 바깥 미들웨어가 에러를 삼켜도 inner(로더)가 안 돌았으면 가드를 통과하지 못한 것
    if (innerCalled) return { type: 'ok' };
  } catch {
    // failure 에 기록됨
  }
  if (!failure) return { type: 'ok' };
  if (isRedirect(failure.error)) return { type: 'redirect', signal: failure.error };
  return { type: 'error', ...failure };
};

export interface RunRouteOptions extends Omit<RunLoadersOptions, 'onError'> {
  /** 의도되지 않은 에러 보고. source 로 미들웨어·로더 구분 */
  onError?: (error: unknown, source: 'middleware' | 'loader') => void;
  /** 미들웨어 총 시간(로더 제외)과 로더별 시간 (ms) */
  onTiming?: (name: 'middleware' | { routeId: string }, ms: number) => void;
  /** 미들웨어 맨 안쪽에서 실행할 단계. 기본: 로더. 변경 요청은 action → 로더 (runAction) */
  inner?: (options: RunLoadersOptions) => Promise<LoaderResult>;
}

const now = () => performance.now();

/** 미들웨어 실패 시: 실패 지점 위쪽 로더만 돌려 경계 라우트까지 그릴 데이터를 만든다 */
const failedResult = async (
  options: RunRouteOptions,
  headerList: Headers[],
  failure: { index: number; error: unknown },
  loaded: LoaderResult | undefined,
  loaderOptions: RunLoadersOptions,
): Promise<LoaderResult> => {
  const { matches, modules, dev } = options;
  const { index, error } = failure;
  const above =
    loaded ??
    (await runLoaders({
      ...loaderOptions,
      matches: matches.slice(0, index),
      modules: modules.slice(0, index),
      headerList: headerList.slice(0, index),
    }));
  const headers = mergeHeaders(headerList);
  if (above.type === 'redirect') return { ...above, headers };
  const routes = matches.map((m) => m.id);
  const data: Record<string, unknown> = {};
  for (const id of routes.slice(0, index)) {
    if (id in above.payload.data) data[id] = above.payload.data[id];
  }
  // 실패 지점보다 위쪽 로더 에러가 우선
  if (above.payload.error && (above.failedIndex ?? index) < index) {
    return { type: 'data', payload: { ...above.payload, routes, data }, headers };
  }
  if (isReportable(error)) options.onError?.(error, 'middleware');
  const routeError = toRouteError(error, dev);
  return {
    type: 'data',
    payload: {
      routes,
      data,
      status: routeError.status,
      error: { routeId: findBoundary(matches, modules, index), error: routeError },
    },
    headers,
  };
};

/** 미들웨어 → 로더 파이프라인. 문서·데이터 요청이 함께 쓴다 */
export const runRoute = async (options: RunRouteOptions): Promise<LoaderResult> => {
  const headerList = options.matches.map(() => new Headers());
  // 미들웨어 시간을 먼저 알리려고 로더 시간은 모았다가 뒤에 보낸다
  const loaderTimes: Array<[number, number]> = [];
  const loaderOptions: RunLoadersOptions = {
    ...options,
    headerList,
    onError: (error) => options.onError?.(error, 'loader'),
    onLoaderTime: (index, ms) => loaderTimes.push([index, ms]),
  };
  let loaded: LoaderResult | undefined;
  let innerMs = 0;
  const start = now();
  const outcome = await runMiddleware(
    options.matches,
    options.modules,
    {
      request: options.request,
      context: options.context,
      signal: options.signal,
      headers: headerList,
    },
    async () => {
      const innerStart = now();
      loaded = await (options.inner ?? runLoaders)(loaderOptions);
      innerMs = now() - innerStart;
    },
  );
  if (options.modules.some((m) => m.middleware)) {
    options.onTiming?.('middleware', now() - start - innerMs);
  }
  const reportLoaderTimes = () => {
    for (const [index, ms] of loaderTimes.splice(0)) {
      options.onTiming?.({ routeId: options.matches[index]!.id }, ms);
    }
  };
  reportLoaderTimes();

  if (outcome.type === 'ok') return loaded!;
  if (outcome.type === 'redirect') {
    const { to, status } = outcome.signal;
    return { type: 'redirect', to, status, headers: mergeHeaders(headerList) };
  }
  const result = await failedResult(options, headerList, outcome, loaded, loaderOptions);
  reportLoaderTimes();
  return result;
};
