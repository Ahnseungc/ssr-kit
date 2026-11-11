import type { RouteModuleLoader } from './core/types';

export { httpError, notFound, redirect } from './core/errors';
export type { Href, HrefFor, PatternHref, Register, RoutePattern } from './core/href';
export { href } from './core/href';
export { defineRoutes } from './core/match';
export type {
  Action,
  ActionArgs,
  ActionData,
  ActionRequest,
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
export type { FormProps, LinkProps } from './react/components';
export { DefaultDocument, DefaultErrorPage, Form, Head, Link, Outlet } from './react/components';
export type {
  FormMethod,
  NavigateOptions,
  NavigationState,
  RouterLocation,
  SubmitOptions,
  SubmitTarget,
} from './react/context';
export {
  useActionData,
  useLoaderData,
  useLocation,
  useNavigate,
  useNavigation,
  useParams,
  useRequestContext,
  useRevalidate,
  useRouteLoaderData,
  useSubmit,
} from './react/hooks';

/** Vite 플러그인이 routes 파일의 `() => import()` 를 감쌀 때 쓰는 내부 헬퍼 */
export const __ssrkModule = (load: RouteModuleLoader, file: string): RouteModuleLoader => {
  load.file = file;
  return load;
};
