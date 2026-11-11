import { flushSync } from 'react-dom';

import { createMatcher } from '../core/match';
import { deserialize } from '../core/serialize';
import type { RouteDef, RouteMatch, RouteModule, SsrPayload } from '../core/types';
import type {
  NavigateOptions,
  RouterActions,
  RouterState,
  SubmitOptions,
  SubmitTarget,
} from '../react/context';
import { showDevOverlay } from './overlay';

type DataResponse =
  { type: 'data'; payload: unknown[] } | { type: 'redirect'; to: string; status: number };

type Mode = 'push' | 'replace' | 'pop' | 'revalidate';

const PREFETCH_TTL_MS = 10_000;
/** 데이터 응답의 redirect 는 HTTP 200 이라 브라우저 한도가 안 걸린다. 넘으면 문서 이동에 맡긴다 */
const MAX_REDIRECTS = 10;
const SCROLL_STORAGE_KEY = 'ssrk:scroll';

const createKey = () => Math.random().toString(36).slice(2, 10);

const readScrollPositions = (): Record<string, number> => {
  try {
    return JSON.parse(sessionStorage.getItem(SCROLL_STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
};

const writeScrollPositions = (positions: Record<string, number>) => {
  try {
    sessionStorage.setItem(SCROLL_STORAGE_KEY, JSON.stringify(positions));
  } catch {
    // 저장소를 못 쓰면 스크롤 복원만 포기한다
  }
};

const needsData = (modules: RouteModule[]) =>
  modules.some((m) => m.loader || m.middleware || m.__ssrkLoader);

const loadModules = (matches: RouteMatch[]) => Promise.all(matches.map((m) => m.route.module()));

const toFormData = (target: SubmitTarget) => {
  if (target instanceof FormData) return target;
  const formData = new FormData();
  const entries = target instanceof URLSearchParams ? target : Object.entries(target);
  for (const [key, value] of entries) formData.append(key, value);
  return formData;
};

/** 파일이 없으면 JS 없는 폼과 같은 urlencoded 로 보낸다 */
const encodeBody = (formData: FormData): FormData | URLSearchParams => {
  const params = new URLSearchParams();
  for (const [key, value] of formData) {
    if (typeof value !== 'string') return formData;
    params.append(key, value);
  }
  return params;
};

interface Commit {
  mode: Mode;
  url: URL;
  userState: unknown;
  matches: RouteMatch[];
  modules: RouteModule[];
  payload: SsrPayload;
}

export interface ClientRouterInit {
  routes: RouteDef[];
  dataPrefix: string;
  initialState: RouterState;
}

export interface ClientRouter {
  subscribe: (listener: () => void) => () => void;
  getState: () => RouterState;
  actions: RouterActions;
}

export const createClientRouter = ({
  routes,
  dataPrefix,
  initialState,
}: ClientRouterInit): ClientRouter => {
  const matcher = createMatcher(routes);
  const listeners = new Set<() => void>();
  const prefetched = new Map<string, { at: number; response: Promise<DataResponse | null> }>();
  const scroll = readScrollPositions();
  let state = initialState;
  let controller: AbortController | null = null;

  const setState = (patch: Partial<RouterState>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };

  const fetchData = async (url: URL, signal: AbortSignal): Promise<DataResponse> => {
    const response = await fetch(`${dataPrefix}${url.pathname}${url.search}`, {
      signal,
      headers: { accept: 'application/json' },
    });
    return (await response.json()) as DataResponse;
  };

  const takePrefetched = async (url: URL) => {
    const key = url.pathname + url.search;
    const entry = prefetched.get(key);
    prefetched.delete(key);
    if (!entry || Date.now() - entry.at > PREFETCH_TTL_MS) return null;
    return entry.response;
  };

  const safeMatch = (pathname: string) => {
    try {
      return matcher(pathname);
    } catch {
      return null;
    }
  };

  const saveScroll = () => {
    scroll[state.location.key] = window.scrollY;
    writeScrollPositions(scroll);
  };

  const restoreScroll = (mode: Mode, url: URL, key: string) => {
    if (mode === 'revalidate') return;
    if (mode === 'pop') {
      window.scrollTo(0, scroll[key] ?? 0);
      return;
    }
    const target = url.hash ? document.getElementById(decodeURIComponent(url.hash.slice(1))) : null;
    if (target) target.scrollIntoView();
    else window.scrollTo(0, 0);
  };

  const writeHistory = (mode: Mode, url: URL, userState: unknown) => {
    if (mode === 'pop') return (history.state?.key as string | undefined) ?? 'default';
    if (mode === 'revalidate') return state.location.key;
    const key = createKey();
    const entry = { key, usr: userState };
    if (mode === 'push') history.pushState(entry, '', url.href);
    else history.replaceState(entry, '', url.href);
    return key;
  };

  const isHashOnly = (url: URL, mode: Mode) =>
    mode === 'push' &&
    url.hash !== '' &&
    url.pathname === state.location.pathname &&
    url.search === state.location.search;

  const go = async (href: string, mode: Mode, userState?: unknown, hops = 0): Promise<void> => {
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin) return window.location.assign(url.href);

    if (isHashOnly(url, mode)) {
      saveScroll();
      const key = writeHistory(mode, url, userState);
      setState({ location: { ...state.location, hash: url.hash, key, state: userState } });
      restoreScroll(mode, url, key);
      return;
    }

    const matches = safeMatch(url.pathname);
    if (!matches) return window.location.assign(url.href);

    controller?.abort();
    const current = new AbortController();
    controller = current;
    setState({ navigation: { state: 'loading', location: url.pathname + url.search } });

    let modules: RouteModule[];
    let response: DataResponse | null = null;
    try {
      modules = await loadModules(matches);
      if (needsData(modules)) {
        // revalidate 는 최신 데이터가 목적이라 프리패치를 쓰지 않는다
        const reused = mode === 'revalidate' ? null : await takePrefetched(url);
        response = reused ?? (await fetchData(url, current.signal));
      }
    } catch {
      // 청크 삭제(배포)·네트워크 오류 → 서버 렌더로 다시 시도
      if (!current.signal.aborted) window.location.assign(url.href);
      return;
    }
    if (current.signal.aborted) return;
    controller = null;

    if (response?.type === 'redirect') return followRedirect(response, url, mode, userState, hops);

    const payload: SsrPayload = response
      ? deserialize<SsrPayload>(response.payload)
      : { routes: matches.map((m) => m.id), data: {}, status: 200 };
    commit({ mode, url, userState, matches, modules, payload });
  };

  const commit = ({ mode, url, userState, matches, modules, payload }: Commit) => {
    if (state.dev) showDevOverlay(payload.error?.error);
    saveScroll();
    const key = writeHistory(mode, url, userState);
    flushSync(() =>
      setState({
        location: {
          pathname: url.pathname,
          search: url.search,
          hash: url.hash,
          key,
          state: userState,
        },
        matches: matches.filter((m) => payload.routes.includes(m.id)),
        modules: modules.filter((_, i) => payload.routes.includes(matches[i]!.id)),
        payload,
        navigation: { state: 'idle' },
      }),
    );
    restoreScroll(mode, url, key);
  };

  const followRedirect = (
    response: Extract<DataResponse, { type: 'redirect' }>,
    url: URL,
    mode: Mode,
    userState: unknown,
    hops: number,
  ) => {
    const target = new URL(response.to, url);
    if (target.origin !== window.location.origin || hops >= MAX_REDIRECTS) {
      return window.location.assign(target.href);
    }
    const nextMode = mode === 'revalidate' || mode === 'pop' ? 'replace' : mode;
    return go(target.href, nextMode, userState, hops + 1);
  };

  const submit = async (target: SubmitTarget, options: SubmitOptions = {}): Promise<void> => {
    const { pathname, search } = state.location;
    const url = new URL(options.action ?? pathname + search, window.location.href);
    const method = options.method ?? 'post';
    const formData = toFormData(target);
    if (method === 'get') {
      const params = new URLSearchParams();
      for (const [key, value] of formData) if (typeof value === 'string') params.append(key, value);
      url.search = params.toString();
      return go(url.href, options.replace ? 'replace' : 'push');
    }
    if (url.origin !== window.location.origin) {
      throw new Error(`다른 origin 으로는 submit 할 수 없다: ${url.href}`);
    }
    // 같은 주소로 보내면 revalidate 처럼 기록·스크롤을 그대로 둔다
    const sameUrl = url.pathname === pathname && url.search === search;
    let mode: Mode = options.replace ? 'replace' : 'push';
    if (sameUrl) mode = 'revalidate';
    const userState = sameUrl ? state.location.state : undefined;

    controller?.abort();
    const current = new AbortController();
    controller = current;
    setState({
      navigation: {
        state: 'submitting',
        location: url.pathname + url.search,
        formMethod: method.toUpperCase(),
        formData,
      },
    });

    const matches = safeMatch(url.pathname) ?? [];
    let modules: RouteModule[];
    let response: DataResponse;
    try {
      [modules, response] = await Promise.all([
        loadModules(matches),
        fetch(`${dataPrefix}${url.pathname}${url.search}`, {
          method: method.toUpperCase(),
          body: encodeBody(formData),
          signal: current.signal,
          headers: { accept: 'application/json' },
        }).then((r) => r.json() as Promise<DataResponse>),
      ]);
    } catch (error) {
      if (current.signal.aborted) return;
      controller = null;
      setState({ navigation: { state: 'idle' } });
      throw error;
    }
    if (current.signal.aborted) return;
    controller = null;

    if (response.type === 'redirect') return followRedirect(response, url, mode, userState, 0);
    commit({
      mode,
      url,
      userState,
      matches,
      modules,
      payload: deserialize<SsrPayload>(response.payload),
    });
  };

  const prefetch = (to: string, withData: boolean) => {
    const url = new URL(to, window.location.href);
    if (url.origin !== window.location.origin) return;
    const matches = safeMatch(url.pathname);
    if (!matches) return;
    const modules = loadModules(matches);
    // 프리패치 실패는 실제 이동 때 다시 시도한다
    modules.catch(() => {});
    if (!withData) return;

    const key = url.pathname + url.search;
    const existing = prefetched.get(key);
    if (existing && Date.now() - existing.at <= PREFETCH_TTL_MS) return;
    // 모듈 로드 전에 바로 등록해야 직후 이동(focus → click)이 같은 요청을 재사용한다
    const response = modules
      .then((loaded) => (needsData(loaded) ? fetchData(url, new AbortController().signal) : null))
      .catch(() => null);
    prefetched.set(key, { at: Date.now(), response });
  };

  const actions: RouterActions = {
    navigate: (to: string, options: NavigateOptions = {}) => {
      void go(to, options.replace ? 'replace' : 'push', options.state);
    },
    revalidate: () => {
      // 진행 중인 이동이 있으면 그 이동이 최신 데이터를 가져오므로 끊지 않는다
      if (controller) return;
      void go(window.location.href, 'revalidate', state.location.state);
    },
    prefetch,
    submit,
  };

  window.addEventListener('popstate', () => {
    void go(window.location.href, 'pop', history.state?.usr);
  });
  // 새로고침·다른 문서로 갔다 돌아올 때도 위치를 복원하도록 문서를 떠날 때 저장
  window.addEventListener('pagehide', saveScroll);
  const savedY = scroll[initialState.location.key];
  if (savedY !== undefined) window.scrollTo(0, savedY);

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState: () => state,
    actions,
  };
};
