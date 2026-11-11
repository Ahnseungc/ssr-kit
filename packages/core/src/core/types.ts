import type { ComponentType, ReactNode } from 'react';

/** 어댑터 공통 요청. raw 는 어댑터 원본(Node 면 IncomingMessage) */
export interface SsrRequest {
  url: URL;
  method: string;
  headers: Headers;
  raw: unknown;
}

/** 사용자가 declaration merging 으로 확장 */
export interface AppContext {}

type Simplify<T> = { [K in keyof T]: T[K] } & {};

type SegmentParams<S extends string> = S extends '*'
  ? { '*': string }
  : S extends `:${infer Name}?`
    ? { [K in Name]?: string }
    : S extends `:${infer Name}`
      ? { [K in Name]: string }
      : {};

type PathParams<P extends string> = P extends `${infer Head}/${infer Rest}`
  ? SegmentParams<Head> & PathParams<Rest>
  : SegmentParams<P>;

export type Params<P extends string = string> = string extends P
  ? Record<string, string | undefined>
  : Simplify<PathParams<P>>;

export interface LoaderArgs<Path extends string = string> {
  params: Params<Path>;
  request: SsrRequest;
  /** 응답 헤더 누적. 같은 헤더는 더 깊은 라우트가 이긴다 */
  headers: Headers;
  /** 클라 연결 종료·렌더 타임아웃 시 abort */
  signal: AbortSignal;
  context: AppContext;
}

// 사용자 로더는 구체적인 Params 타입을 받으므로 인자를 any 로 둔다
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Loader = (args: LoaderArgs<any>) => unknown;

export type LoaderData<L> = L extends (...args: never[]) => infer R ? Awaited<R> : never;

export interface HeadArgs<L = unknown> {
  data: LoaderData<L>;
  params: Record<string, string | undefined>;
}

export interface MetaTag {
  name?: string;
  property?: string;
  charSet?: string;
  content?: string;
}

export interface LinkTag {
  rel: string;
  href: string;
  [attr: string]: string | undefined;
}

export interface HeadTags {
  title?: string;
  meta?: MetaTag[];
  link?: LinkTag[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type HeadFn = (args: HeadArgs<any>) => HeadTags;

export interface RouteError {
  status: number;
  message: string;
  /** dev 에서만 */
  stack?: string;
}

export interface RouteModule {
  default: ComponentType;
  loader?: Loader;
  head?: HeadFn;
  ErrorBoundary?: ComponentType<{ error: RouteError }>;
  /** Vite 플러그인이 클라 번들에서 loader 를 지운 자리에 남기는 표시 */
  __ssrkLoader?: true;
}

export interface RouteModuleLoader {
  (): Promise<RouteModule>;
  /** Vite 플러그인이 붙이는 root 기준 경로 = 매니페스트 키 */
  file?: string;
}

export interface RouteDef {
  /** 생략 시 부모 id + 인덱스 */
  id?: string;
  /** 생략 = pathless 레이아웃 */
  path?: string;
  module: RouteModuleLoader;
  children?: RouteDef[];
  /** false 면 이 라우트 이하 SPA 셸만 응답 */
  ssr?: boolean;
}

export interface RouteMatch {
  id: string;
  route: RouteDef;
  params: Record<string, string | undefined>;
}

export interface DocumentProps {
  children: ReactNode;
}

/** 서버 → 클라로 넘기는 값 (직렬화 대상) */
export interface SsrPayload {
  routes: string[];
  data: Record<string, unknown>;
  /** routeId: 에러를 렌더할 경계 라우트. null 이면 루트 에러 UI */
  error?: { routeId: string | null; error: RouteError };
  status: number;
  /** ssr:false 셸 응답 */
  shell?: boolean;
}
