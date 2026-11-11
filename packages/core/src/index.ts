import type { RouteModuleLoader } from './core/types';

export { httpError, notFound, redirect } from './core/errors';
export { defineRoutes } from './core/match';
export type {
  AppContext,
  DocumentProps,
  HeadArgs,
  HeadTags,
  LinkTag,
  LoaderArgs,
  LoaderData,
  MetaTag,
  Middleware,
  MiddlewareArgs,
  Params,
  RouteDef,
  RouteError,
  RouteModule,
  RouteModuleLoader,
  SsrRequest,
} from './core/types';
export type { LinkProps } from './react/components';
export { DefaultDocument, DefaultErrorPage, Head, Link, Outlet } from './react/components';
export type { NavigateOptions, NavigationState, RouterLocation } from './react/context';
export {
  useLoaderData,
  useLocation,
  useNavigate,
  useNavigation,
  useParams,
  useRequestContext,
  useRevalidate,
  useRouteLoaderData,
} from './react/hooks';

/** Vite 플러그인이 routes 파일의 `() => import()` 를 감쌀 때 쓰는 내부 헬퍼 */
export const __ssrkModule = (load: RouteModuleLoader, file: string): RouteModuleLoader => {
  load.file = file;
  return load;
};
