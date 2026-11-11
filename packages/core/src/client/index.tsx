import { type ComponentType, useSyncExternalStore } from 'react';
import { hydrateRoot } from 'react-dom/client';

import { createMatcher } from '../core/match';
import { deserialize } from '../core/serialize';
import type { DocumentProps, RouteDef, SsrPayload } from '../core/types';
import { DefaultDocument, Root } from '../react/components';
import { RouterActionsContext, type RouterState, RouterStateContext } from '../react/context';
import { type ClientRouter, createClientRouter } from './router';

declare global {
  interface Window {
    __SSRK?: unknown[];
  }
}

export interface HydrateOptions {
  routes: RouteDef[];
  Document?: ComponentType<DocumentProps>;
  dataPrefix?: string;
  dev?: boolean;
  onError?: (error: unknown) => void;
}

const DEFAULT_DATA_PREFIX = '/_data';

/** 서버가 bootstrapScriptContent 로 넣은 값을 읽는다 (RT6 저수준 API 용) */
export const readSsrData = <T,>(): T => {
  if (!window.__SSRK) throw new Error('ssr-kit 서버 데이터(window.__SSRK)가 없다');
  return deserialize<T>(window.__SSRK);
};

const RouterProvider = ({
  router,
  Document,
}: {
  router: ClientRouter;
  Document: ComponentType<DocumentProps>;
}) => {
  const state = useSyncExternalStore(router.subscribe, router.getState, router.getState);
  return (
    <RouterActionsContext value={router.actions}>
      <RouterStateContext value={state}>
        <Root Document={Document} />
      </RouterStateContext>
    </RouterActionsContext>
  );
};

const matchSafely = (routes: RouteDef[], pathname: string) => {
  try {
    return createMatcher(routes)(pathname) ?? [];
  } catch {
    return [];
  }
};

const ensureHistoryKey = (): string => {
  const existing = history.state?.key as string | undefined;
  if (existing) return existing;
  const key = Math.random().toString(36).slice(2, 10);
  history.replaceState({ ...(history.state ?? {}), key }, '');
  return key;
};

export const hydrate = async ({
  routes,
  Document = DefaultDocument,
  dataPrefix = DEFAULT_DATA_PREFIX,
  dev = false,
  onError = (error) => console.error(error),
}: HydrateOptions): Promise<void> => {
  const payload = readSsrData<SsrPayload>();
  const matches = matchSafely(routes, window.location.pathname).filter((m) =>
    payload.routes.includes(m.id),
  );
  const modules = await Promise.all(matches.map((m) => m.route.module()));

  history.scrollRestoration = 'manual';
  const initialState: RouterState = {
    location: {
      pathname: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash,
      key: ensureHistoryKey(),
      state: history.state?.usr,
    },
    matches,
    modules,
    payload,
    navigation: { state: 'idle' },
    dev,
  };
  const router = createClientRouter({ routes, dataPrefix, initialState });

  hydrateRoot(document, <RouterProvider router={router} Document={Document} />, {
    onRecoverableError: onError,
    onCaughtError: onError,
    onUncaughtError: onError,
  });

  if (payload.shell) router.actions.revalidate();
};
