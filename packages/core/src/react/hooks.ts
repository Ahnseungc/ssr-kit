import { useContext } from 'react';

import type { Href } from '../core/href';
import type { ActionData, AppContext, LoaderData } from '../core/types';
import {
  type NavigateOptions,
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

export const useNavigate = (): ((to: Href, options?: NavigateOptions) => void) =>
  useContext(RouterActionsContext).navigate;

export const useSubmit = () => useContext(RouterActionsContext).submit;

/** 마지막 action 반환값. 이동하면 사라진다 */
export const useActionData = <A = unknown>(): ActionData<A> | undefined =>
  useRouterState().payload.actionData as ActionData<A> | undefined;

export const useRevalidate = () => useContext(RouterActionsContext).revalidate;

/** 서버: getContext 반환값, 클라: null */
export const useRequestContext = (): AppContext | null => useContext(RequestContextContext);
