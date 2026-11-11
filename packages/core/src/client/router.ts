import { flushSync } from 'react-dom';

import { createMatcher } from '../core/match';
import { deserialize } from '../core/serialize';
import type { RouteDef, RouteMatch, RouteModule, SsrPayload } from '../core/types';
import type { NavigateOptions, RouterActions, RouterState } from '../react/context';
import { showDevOverlay } from './overlay';

type DataResponse =
  { type: 'data'; payload: unknown[] } | { type: 'redirect'; to: string; status: number };

type Mode = 'push' | 'replace' | 'pop' | 'revalidate';

const PREFETCH_TTL_MS = 10_000;
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

const needsData = (modules: RouteModule[]) => modules.some((m) => m.loader || m.__ssrkLoader);

const loadModules = (matches: RouteMatch[]) => Promise.all(matches.map((m) => m.route.module()));

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

  const go = async (href: string, mode: Mode, userState?: unknown): Promise<void> => {
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
        response = (await takePrefetched(url)) ?? (await fetchData(url, current.signal));
      }
    } catch {
      // 청크 삭제(배포)·네트워크 오류 → 서버 렌더로 다시 시도
      if (!current.signal.aborted) window.location.assign(url.href);
      return;
    }
    if (current.signal.aborted) return;
    controller = null;

    if (response?.type === 'redirect') {
      const target = new URL(response.to, url);
      if (target.origin !== window.location.origin) return window.location.assign(target.href);
      return go(target.href, mode === 'revalidate' ? 'replace' : mode === 'pop' ? 'replace' : mode);
    }

    const payload: SsrPayload = response
      ? deserialize<SsrPayload>(response.payload)
      : { routes: matches.map((m) => m.id), data: {}, status: 200 };

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
      void go(window.location.href, 'revalidate', state.location.state);
    },
    prefetch,
  };

  window.addEventListener('popstate', () => {
    void go(window.location.href, 'pop', history.state?.usr);
  });

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState: () => state,
    actions,
  };
};
