import { createContext, useContext } from 'react';

import type { AppContext, RouteMatch, RouteModule, SsrPayload } from '../core/types';

export interface RouterLocation {
  pathname: string;
  search: string;
  hash: string;
  /** history 항목 키. 스크롤 복원·에러 경계 리셋에 사용 */
  key: string;
  state?: unknown;
}

export interface NavigationState {
  state: 'idle' | 'loading';
  location?: string;
}

export interface RouterState {
  location: RouterLocation;
  matches: RouteMatch[];
  modules: RouteModule[];
  payload: SsrPayload;
  navigation: NavigationState;
  dev: boolean;
}

export interface NavigateOptions {
  replace?: boolean;
  state?: unknown;
}

export interface RouterActions {
  navigate: (to: string, options?: NavigateOptions) => void;
  revalidate: () => void;
  prefetch: (to: string, withData: boolean) => void;
}

const noop = () => {};

export const RouterStateContext = createContext<RouterState | null>(null);
export const RouterActionsContext = createContext<RouterActions>({
  navigate: noop,
  revalidate: noop,
  prefetch: noop,
});
/** 현재 렌더 중인 라우트의 matches index */
export const RouteIndexContext = createContext<number>(-1);
export const RequestContextContext = createContext<AppContext | null>(null);

export const useRouterState = (): RouterState => {
  const state = useContext(RouterStateContext);
  if (!state) throw new Error('ssr-kit 라우터 밖에서 훅을 호출했다');
  return state;
};

/** 에러 경계 라우트 index. 에러가 없으면 -1, 루트 에러면 null */
export const boundaryIndexOf = (state: RouterState): number | null => {
  const error = state.payload.error;
  if (!error) return -1;
  if (error.routeId === null) return null;
  return state.matches.findIndex((m) => m.id === error.routeId);
};
