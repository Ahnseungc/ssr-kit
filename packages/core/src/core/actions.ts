import { isRedirect, isReportable, toRouteError } from './errors';
import {
  findBoundary,
  type LoaderResult,
  mergeHeaders,
  runLoaders,
  type RunLoadersOptions,
} from './loaders';
import type { ActionRequest, RouteModule, SsrRequest } from './types';

/** action 을 실행하는 메서드. 그 외(OPTIONS 등)는 GET·HEAD 가 아니면 어댑터가 다음 핸들러로 넘긴다 */
const ACTION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** POST 뒤 redirect 는 브라우저가 GET 으로 따라가도록 303. 307·308 은 사용자가 의도한 재전송이라 유지 */
const SEE_OTHER = 303;
const PRESERVED_REDIRECTS = new Set([307, 308]);

export const isActionMethod = (method: string) => ACTION_METHODS.has(method.toUpperCase());

/** action 을 export 한 가장 깊은 매치 index. 없으면 -1 */
export const findActionIndex = (modules: RouteModule[]) => {
  for (let i = modules.length - 1; i >= 0; i -= 1) {
    if (typeof modules[i]!.action === 'function') return i;
  }
  return -1;
};

const originOf = (value: string | null) => {
  if (!value || value === 'null') return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

/**
 * CSRF: Origin(없으면 Referer)의 host 가 요청 host 와 같거나 allowedOrigins 에 있어야 한다.
 * TLS 를 앞단 프록시가 끝내면 요청 URL 의 scheme 이 http 라 origin 전체 대신 host 를 비교한다.
 */
export const isTrustedOrigin = (request: SsrRequest, allowedOrigins: string[] = []) => {
  const source =
    originOf(request.headers.get('origin')) ?? originOf(request.headers.get('referer'));
  if (!source) return false;
  return source.host === request.url.host || allowedOrigins.includes(source.origin);
};

/** 본문은 처음 읽을 때 한 번만 소비하고, 해석은 호출마다 새 Response 로 한다 */
export const toActionRequest = (request: SsrRequest): ActionRequest => {
  let body: Promise<Uint8Array | ArrayBuffer> | undefined;
  const parse = async () => {
    body ??= request.readBody?.() ?? Promise.resolve(new Uint8Array());
    const headers = new Headers();
    const type = request.headers.get('content-type');
    if (type) headers.set('content-type', type);
    return new Response((await body) as BodyInit, { headers });
  };
  return {
    ...request,
    formData: async () => (await parse()).formData(),
    json: async <T>() => (await parse()).json() as Promise<T>,
    text: async () => (await parse()).text(),
  };
};

/** source 를 target 에 덮어쓴다(Set-Cookie 는 append) */
const applyHeaders = (target: Headers, source: Headers) => {
  for (const [key, value] of source) if (key !== 'set-cookie') target.set(key, value);
  for (const cookie of source.getSetCookie()) target.append('set-cookie', cookie);
  return target;
};

const redirectStatus = (status: number) => (PRESERVED_REDIRECTS.has(status) ? status : SEE_OTHER);

export interface RunActionOptions extends RunLoadersOptions {
  /** 의도되지 않은 action 에러 보고 */
  onActionError?: (error: unknown) => void;
}

/** action 이 실패하면 경계 위쪽 로더만 돌려 레이아웃 데이터를 채우고 action 에러를 그린다 */
const actionErrorResult = async (
  options: RunActionOptions,
  index: number,
  error: unknown,
): Promise<LoaderResult> => {
  const { matches, modules } = options;
  const result = await runLoaders({
    ...options,
    matches: matches.slice(0, index),
    modules: modules.slice(0, index),
  });
  if (result.type === 'redirect') return result;
  const routes = matches.map((m) => m.id);
  // 더 위쪽 로더가 실패했으면 그 에러가 우선
  if (result.payload.error) return { ...result, payload: { ...result.payload, routes } };
  const routeError = toRouteError(error, options.dev);
  return {
    type: 'data',
    headers: result.headers,
    payload: {
      routes,
      data: result.payload.data,
      status: routeError.status,
      error: { routeId: findBoundary(matches, modules, index), error: routeError },
    },
  };
};

/**
 * 가장 깊은 action 을 실행한 뒤 성공하면 매치된 로더 전부를 다시 돌린다.
 * 반환값은 payload.actionData 로 실린다. action 이 없으면 호출하지 않는다(findActionIndex 로 먼저 확인).
 */
export const runAction = async (options: RunActionOptions): Promise<LoaderResult> => {
  const { matches, modules } = options;
  const index = findActionIndex(modules);
  const actionHeaders = new Headers();
  let actionData: unknown;
  try {
    actionData = await modules[index]!.action!({
      params: matches[index]!.params,
      request: toActionRequest(options.request),
      headers: actionHeaders,
      signal: options.signal,
      context: options.context,
    });
  } catch (error) {
    if (isRedirect(error)) {
      return {
        type: 'redirect',
        to: error.to,
        status: redirectStatus(error.status),
        // 미들웨어가 붙인 헤더(Set-Cookie 등)도 redirect 응답에 싣는다
        headers: mergeHeaders([...(options.headerList ?? []), actionHeaders]),
      };
    }
    if (isReportable(error)) options.onActionError?.(error);
    const result = await actionErrorResult(options, index, error);
    applyHeaders(result.headers, actionHeaders);
    return result;
  }

  const result = await runLoaders(options);
  applyHeaders(result.headers, actionHeaders);
  if (result.type === 'data') result.payload.actionData = actionData;
  return result;
};
