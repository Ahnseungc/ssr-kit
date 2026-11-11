import { useContext } from 'react';

import type { AppContext, LoaderData } from '../core/types';
import {
  type NavigationState,
  RequestContextContext,
  RouteIndexContext,
  RouterActionsContext,
  type RouterLocation,
  useRouterState,
} from './context';

export const useLoaderData = <L = unknown>(): LoaderData<L> => {
  const state = useRouterState();
  const index = useContext(RouteIndexContext);
  const match = state.matches[index];
  if (!match) throw new Error('useLoaderData 는 라우트 컴포넌트 안에서만 호출할 수 있다');
  return state.payload.data[match.id] as LoaderData<L>;
};

export const useRouteLoaderData = <L = unknown>(routeId: string): LoaderData<L> | undefined =>
  useRouterState().payload.data[routeId] as LoaderData<L> | undefined;

export const useParams = (): Record<string, string | undefined> => {
  const { matches } = useRouterState();
  return matches[matches.length - 1]?.params ?? {};
};

export const useLocation = (): RouterLocation => useRouterState().location;

export const useNavigation = (): NavigationState => useRouterState().navigation;

export const useNavigate = () => useContext(RouterActionsContext).navigate;

export const useRevalidate = () => useContext(RouterActionsContext).revalidate;

/** 서버: getContext 반환값, 클라: null */
export const useRequestContext = (): AppContext | null => useContext(RequestContextContext);
