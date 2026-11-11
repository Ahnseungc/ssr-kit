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

export type FormMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface NavigationState {
  /** submitting: action 요청 중, loading: 데이터·모듈 로드 중 */
  state: 'idle' | 'loading' | 'submitting';
  location?: string;
  /** submitting 일 때 대문자 메서드 (POST 등) */
  formMethod?: string;
  /** submitting 일 때 보낸 값 */
  formData?: FormData;
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

export interface SubmitOptions {
  /** 기본 'post' */
  method?: FormMethod;
  /** 보낼 경로. 기본: 현재 경로+쿼리 */
  action?: string;
  replace?: boolean;
}

export type SubmitTarget = FormData | URLSearchParams | Record<string, string>;

export interface RouterActions {
  navigate: (to: string, options?: NavigateOptions) => void;
  revalidate: () => void;
  prefetch: (to: string, withData: boolean) => void;
  /** action 요청. 네트워크 실패 시 reject */
  submit: (target: SubmitTarget, options?: SubmitOptions) => Promise<void>;
}

const noop = () => {};

export const RouterStateContext = createContext<RouterState | null>(null);
export const RouterActionsContext = createContext<RouterActions>({
  navigate: noop,
  revalidate: noop,
  prefetch: noop,
  submit: () => Promise.reject(new Error('ssr-kit 라우터가 hydrate 되기 전에는 submit 할 수 없다')),
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
