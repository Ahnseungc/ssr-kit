import { type ComponentType, useSyncExternalStore } from 'react';
import { hydrateRoot } from 'react-dom/client';

import { createMatcher } from '../core/match';
import type { DocumentProps, RouteDef, SsrPayload } from '../core/types';
import { DefaultDocument, Root } from '../react/components';
import { RouterActionsContext, type RouterState, RouterStateContext } from '../react/context';
import { readSsrData } from './deferred';
import { type ClientRouter, createClientRouter } from './router';

export { readSsrData };

export interface HydrateOptions {
  routes: RouteDef[];
  Document?: ComponentType<DocumentProps>;
  dataPrefix?: string;
  dev?: boolean;
  onError?: (error: unknown) => void;
}

const DEFAULT_DATA_PREFIX = '/_data';

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

  if (dev) Object.assign(window, { __ssrkRevalidate: router.actions.revalidate });
  if (payload.shell) router.actions.revalidate();
};
