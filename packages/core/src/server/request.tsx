import { preinit, preloadModule } from 'react-dom';

import { isReportable, toRouteError } from '../core/errors';
import { runLoaders } from '../core/loaders';
import { createMatcher, InvalidPathError, type Matcher } from '../core/match';
import { serialize } from '../core/serialize';
import type {
  AppContext,
  RouteDef,
  RouteMatch,
  RouteModule,
  SsrPayload,
  SsrRequest,
} from '../core/types';
import { DefaultDocument, Root } from '../react/components';
import { RequestContextContext, type RouterState, RouterStateContext } from '../react/context';
import type { ResolvedAssets, ServerBuild } from './build';
import { serializeSettledPayload } from './payload';
import type { ErrorPhase, RenderSink } from './sink';

export type { ErrorPhase, RenderSink, TreeRenderOptions } from './sink';

export interface HandleOptions {
  getContext?: (request: SsrRequest) => AppContext | Promise<AppContext>;
  isBot: boolean;
  renderTimeout: number;
  nonce?: string;
  onError?: (error: unknown, info: { url: string; phase: ErrorPhase }) => void;
  /** 매치 없을 때: 'next' 면 'unmatched' 반환, 'render' 면 404 렌더 */
  unmatched: 'next' | 'render';
}

export type HandleResult = 'handled' | 'unmatched';

const matchers = new WeakMap<RouteDef[], Matcher>();

const getMatcher = (routes: RouteDef[]) => {
  let matcher = matchers.get(routes);
  if (!matcher) {
    matcher = createMatcher(routes);
    matchers.set(routes, matcher);
  }
  return matcher;
};

const NOT_FOUND_PAYLOAD: SsrPayload = {
  routes: [],
  data: {},
  status: 404,
  error: { routeId: null, error: { status: 404, message: 'Not Found' } },
};

const report = (
  build: ServerBuild,
  options: HandleOptions,
  request: SsrRequest,
  phase: ErrorPhase,
  error: unknown,
) => {
  if (!isReportable(error)) return;
  if (error instanceof Error) build.fixStacktrace?.(error);
  if (options.onError) options.onError(error, { url: request.url.href, phase });
  else console.error(`[ssr-kit] ${phase} 에러 (${request.url.pathname})`, error);
};

const loadModules = (matches: RouteMatch[]) => Promise.all(matches.map((m) => m.route.module()));

const routeFiles = (matches: RouteMatch[]) =>
  matches.map((m) => m.route.module.file).filter((file): file is string => Boolean(file));

const textResponse = (sink: RenderSink, status: number, text: string) => {
  sink.writeHead(status, new Headers({ 'content-type': 'text/plain; charset=utf-8' }));
  sink.end(text);
};

const jsonResponse = (sink: RenderSink, status: number, headers: Headers, body: string) => {
  headers.set('content-type', 'application/json; charset=utf-8');
  sink.writeHead(status, headers);
  sink.end(body);
};

interface DocumentInput {
  state: RouterState;
  status: number;
  headers: Headers;
  context: AppContext | null;
  assets: ResolvedAssets;
}

const ServerRoot = ({ build, assets }: { build: ServerBuild; assets: ResolvedAssets }) => {
  for (const href of assets.modules) preloadModule(href);
  for (const href of assets.styles) preinit(href, { as: 'style', precedence: 'default' });
  return <Root Document={build.Document ?? DefaultDocument} />;
};

const renderDocument = (
  build: ServerBuild,
  request: SsrRequest,
  sink: RenderSink,
  options: HandleOptions,
  input: DocumentInput,
  isFallback = false,
): Promise<void> =>
  sink.renderTree(
    <RequestContextContext value={input.context}>
      <RouterStateContext value={input.state}>
        <ServerRoot build={build} assets={input.assets} />
      </RouterStateContext>
    </RequestContextContext>,
    {
      method: request.method,
      status: input.status,
      headers: input.headers,
      bootstrapModules: build.bootstrapModules,
      data: input.state.payload,
      dev: build.dev,
      nonce: options.nonce,
      isBot: options.isBot,
      renderTimeout: options.renderTimeout,
      report: (phase, error) => report(build, options, request, phase, error),
      onShellError: (error) => {
        if (isFallback) return textResponse(sink, 500, 'Internal Server Error');
        return renderDocument(
          build,
          request,
          sink,
          options,
          rootErrorInput(build, input, error),
          true,
        );
      },
    },
  );

const rootErrorInput = (
  build: ServerBuild,
  input: DocumentInput,
  error: unknown,
): DocumentInput => {
  const routeError = toRouteError(error, build.dev);
  return {
    ...input,
    status: routeError.status,
    state: {
      ...input.state,
      matches: [],
      modules: [],
      payload: {
        routes: [],
        data: {},
        status: routeError.status,
        error: { routeId: null, error: routeError },
      },
    },
  };
};

const initialState = (
  request: SsrRequest,
  matches: RouteMatch[],
  modules: RouteModule[],
  payload: SsrPayload,
  dev: boolean,
): RouterState => ({
  location: {
    pathname: request.url.pathname,
    search: request.url.search,
    hash: '',
    key: 'default',
  },
  matches,
  modules,
  payload,
  navigation: { state: 'idle' },
  dev,
});

const matchOrInvalid = (build: ServerBuild, pathname: string, sink: RenderSink) => {
  try {
    return { matches: getMatcher(build.routes)(pathname) };
  } catch (error) {
    if (!(error instanceof InvalidPathError)) throw error;
    textResponse(sink, 400, 'Bad Request');
    return null;
  }
};

const handleData = async (
  build: ServerBuild,
  request: SsrRequest,
  sink: RenderSink,
  options: HandleOptions,
): Promise<HandleResult> => {
  if (request.method !== 'GET') {
    textResponse(sink, 405, 'Method Not Allowed');
    return 'handled';
  }
  const pageUrl = new URL(request.url);
  pageUrl.pathname = request.url.pathname.slice(build.dataPrefix.length) || '/';
  const pageRequest = { ...request, url: pageUrl };

  const matched = matchOrInvalid(build, pageUrl.pathname, sink);
  if (!matched) return 'handled';
  if (!matched.matches) {
    const body = `{"type":"data","payload":${serialize(NOT_FOUND_PAYLOAD)}}`;
    jsonResponse(sink, 404, new Headers({ 'cache-control': 'no-store' }), body);
    return 'handled';
  }

  const modules = await loadModules(matched.matches);
  const context = (await options.getContext?.(pageRequest)) ?? {};
  const result = await runLoaders({
    matches: matched.matches,
    modules,
    request: pageRequest,
    context,
    signal: sink.signal,
    dev: build.dev,
    onError: (error) => report(build, options, pageRequest, 'data', error),
  });

  if (result.type === 'redirect') {
    const body = JSON.stringify({ type: 'redirect', to: result.to, status: result.status });
    jsonResponse(sink, 200, result.headers, body);
    return 'handled';
  }
  const payload = await serializeSettledPayload(result.payload, build.dev);
  jsonResponse(sink, result.payload.status, result.headers, `{"type":"data","payload":${payload}}`);
  return 'handled';
};

const isDataRequest = (build: ServerBuild, pathname: string) =>
  pathname === build.dataPrefix || pathname.startsWith(`${build.dataPrefix}/`);

export const handleRequest = async (
  build: ServerBuild,
  request: SsrRequest,
  sink: RenderSink,
  options: HandleOptions,
): Promise<HandleResult> => {
  if (isDataRequest(build, request.url.pathname)) {
    return handleData(build, request, sink, options);
  }

  const matched = matchOrInvalid(build, request.url.pathname, sink);
  if (!matched) return 'handled';
  const { matches } = matched;

  if (!matches) {
    if (options.unmatched === 'next') return 'unmatched';
    await renderDocument(build, request, sink, options, {
      state: initialState(request, [], [], NOT_FOUND_PAYLOAD, build.dev),
      status: 404,
      headers: new Headers({ 'cache-control': 'no-store' }),
      context: null,
      assets: await build.resolveAssets([]),
    });
    return 'handled';
  }

  const modules = await loadModules(matches);
  const assets = await build.resolveAssets(routeFiles(matches));

  if (matches.some((m) => m.route.ssr === false)) {
    const payload: SsrPayload = { routes: [], data: {}, status: 200, shell: true };
    await renderDocument(build, request, sink, options, {
      state: initialState(request, [], [], payload, build.dev),
      status: 200,
      headers: new Headers({ 'cache-control': 'no-cache' }),
      context: null,
      assets,
    });
    return 'handled';
  }

  const context = (await options.getContext?.(request)) ?? {};
  const result = await runLoaders({
    matches,
    modules,
    request,
    context,
    signal: sink.signal,
    dev: build.dev,
    onError: (error) => report(build, options, request, 'loader', error),
  });

  if (result.type === 'redirect') {
    result.headers.set('location', result.to);
    sink.writeHead(result.status, result.headers);
    sink.end();
    return 'handled';
  }

  await renderDocument(build, request, sink, options, {
    state: initialState(request, matches, modules, result.payload, build.dev),
    status: result.payload.status,
    headers: result.headers,
    context,
    assets,
  });
  return 'handled';
};
