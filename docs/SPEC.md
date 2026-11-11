# ssr-kit 기술 스펙

- 작성: 안승찬 · 2026-11-11
- 상태: Draft v0.1
- 근거: [PRD.md](./PRD.md) v0.1 — 요구사항 ID(R1, RT1, D1 …)는 PRD 표기를 그대로 쓴다.
- 범위: M1(MVP, P0) 구현에 필요한 결정 전부 + P1 은 인터페이스만 고정.

---

## 0. PRD 미결 질문 결정

| PRD §13 | 결정 | 이유 |
|---|---|---|
| Q2 데이터 엔드포인트 | **경로 prefix 방식** `GET /_data/<원래 경로>?<원래 쿼리>` (prefix 설정 가능) | CDN·리버스 프록시에서 경로 규칙만으로 캐시·라우팅 분리 가능. 쿼리 방식은 원래 쿼리와 섞이고, `Accept` 협상은 캐시 키(`Vary`)가 복잡해짐 |
| Q3 로더 타입 추론 | **`typeof loader` 제네릭** — `useLoaderData<typeof loader>()` | 라우트 ID 레지스트리는 코드 생성이 필요해 G7(얇은 코어)과 충돌 |
| Q4 클라이언트 라우터 | **자체 최소 라우터** + 외부 라우터용 저수준 `render()` (RT6) | 로더·스트리밍·head 와 맞물리는 부분이라 외부 라우터에 위임하면 접착 코드가 더 커짐 |

### 0.1 PRD 와 달라지는 점

PRD §6-2 예시는 `defineRoutes` 안에 `loader` 를 인라인으로 썼다. **스펙에서는 로더를 라우트 모듈 파일의 named export 로 옮긴다.**

- 인라인 로더는 `routes.ts` 가 클라이언트 번들에도 들어가므로, 로더가 import 한 서버 코드(DB 클라이언트, 비밀 키)가 같이 딸려간다.
- 라우트 모듈 파일 단위로 `loader` export 를 제거하는 변환이 정적 분석으로 안전하게 가능하다(§6.3).

## 1. 저장소 구조

```
ssr-kit/
├─ packages/
│  └─ ssr-kit/
│     ├─ src/
│     │  ├─ core/          # 매칭·로더·직렬화·head (런타임 공용, 의존성 0)
│     │  ├─ server/        # renderToPipeableStream 렌더러, 핸들러
│     │  ├─ client/        # hydrate, Router, Link, hooks
│     │  ├─ adapters/      # node(P0) · fastify · hono(P1)
│     │  └─ vite/          # Vite 플러그인, dev 핸들러 (빌드 타임 의존성 허용)
│     └─ package.json      # exports 로 서브패스 노출
├─ examples/
│  ├─ express-basic/
│  ├─ webview-legacy-android/
│  └─ tanstack-query/
├─ docs/
└─ pnpm-workspace.yaml
```

단일 패키지 + 서브패스 exports 로 시작한다. 어댑터별 패키지 분리는 peer 의존성 문제(fastify, hono)가 생길 때 한다.

```jsonc
// packages/ssr-kit/package.json (발췌)
{
  "name": "ssr-kit",
  "type": "module",
  "exports": {
    ".":          { "types": "./dist/core/index.d.ts",   "default": "./dist/core/index.js" },
    "./server":   { "types": "./dist/server/index.d.ts", "default": "./dist/server/index.js" },
    "./client":   { "types": "./dist/client/index.d.ts", "default": "./dist/client/index.js" },
    "./node":     { "types": "./dist/adapters/node.d.ts", "default": "./dist/adapters/node.js" },
    "./vite":     { "types": "./dist/vite/index.d.ts",   "default": "./dist/vite/index.js" }
  },
  "peerDependencies": { "react": "^19", "react-dom": "^19", "vite": "^6 || ^7" },
  "peerDependenciesMeta": { "vite": { "optional": true } },
  "engines": { "node": ">=22" }
}
```

`vite/` 만 빌드 타임 의존성(`oxc-parser`, `magic-string`)을 가진다. 런타임 서브패스(`.`, `server`, `client`, `node`)는 의존성 0 (G7).

## 2. 사용자 측 파일 구성

```
my-app/
├─ vite.config.ts
├─ server.ts                 # 사용자 소유 Node 서버
└─ src/
   ├─ routes.ts              # defineRoutes (클라·서버 공용)
   ├─ Document.tsx           # 선택. 없으면 기본 Document
   └─ pages/
      ├─ RootLayout.tsx
      └─ GoldDetail.tsx      # 라우트 모듈
```

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { ssrKit } from 'ssr-kit/vite';

export default defineConfig({
  plugins: [react(), ssrKit({ routes: './src/routes.ts', document: './src/Document.tsx' })],
});
```

## 3. 공개 API

### 3.1 라우트 정의 (`ssr-kit`)

```ts
export interface RouteDef {
  /** 생략 시 path 로 생성. 중첩 라우트 간 유일해야 함 */
  id?: string;
  /** `/gold/:id`, `/files/*`, `/:lang?/about`. 생략 = pathless 레이아웃 */
  path?: string;
  /** 라우트 모듈 lazy import. 반드시 정적 import() 리터럴 (§6.2) */
  module: () => Promise<RouteModule>;
  children?: RouteDef[];
  /** R6. false 면 이 라우트 이하 SPA 셸만 응답 */
  ssr?: boolean;
}

export function defineRoutes(routes: RouteDef[]): RouteDef[];
```

### 3.2 라우트 모듈

```ts
// src/pages/GoldDetail.tsx
import type { LoaderArgs, HeadArgs } from 'ssr-kit';
import { useLoaderData, redirect, notFound } from 'ssr-kit';

export const loader = async ({ params, request, headers, signal }: LoaderArgs<'/gold/:id'>) => {
  const res = await fetch(`${API}/gold/${params.id}`, { headers: { cookie: request.headers.cookie ?? '' }, signal });
  if (res.status === 404) throw notFound();
  headers.set('Cache-Control', 'private, max-age=0');
  return { gold: (await res.json()) as Gold, fetchedAt: new Date() };
};

export const head = ({ data }: HeadArgs<typeof loader>) => ({
  title: data.gold.name,
  meta: [{ name: 'description', content: data.gold.summary }],
});

export const ErrorBoundary = ({ error }: { error: RouteError }) => <p>{error.status}</p>;

export default function GoldDetail() {
  const { gold, fetchedAt } = useLoaderData<typeof loader>(); // fetchedAt: Date 그대로
  return <h1>{gold.name}</h1>;
}
```

| export | 실행 위치 | 필수 | 비고 |
|---|---|---|---|
| `default` | 서버·클라 | O | 라우트 컴포넌트. 레이아웃은 `<Outlet />` 렌더 |
| `loader` | **서버 전용** | X | 클라 번들에서 제거 (§6.3) |
| `head` | 서버·클라 | X | 클라 이동 시에도 실행해 `document.title` 등 갱신 |
| `ErrorBoundary` | 서버·클라 | X | 이 라우트 이하 에러 처리 |

### 3.3 로더 타입

```ts
export interface LoaderArgs<Path extends string = string> {
  params: Params<Path>;            // '/gold/:id' → { id: string }, ':lang?' → { lang?: string }
  url: URL;
  /** Node IncomingMessage. 사용자 미들웨어가 붙인 필드(req.user 등) 접근 가능 */
  request: import('node:http').IncomingMessage;
  /** 응답 헤더 누적. 병합 규칙 §5.4 */
  headers: Headers;
  /** 클라이언트 연결 종료·렌더 타임아웃 시 abort */
  signal: AbortSignal;
  /** 어댑터 `getContext(req)` 반환값 (§3.5) */
  context: AppContext;
}

/** 사용자가 declaration merging 으로 확장 */
export interface AppContext {}

export type LoaderData<L> = L extends (...a: never[]) => infer R ? Awaited<R> : never;
```

`res` 는 로더에 넘기지 않는다. 스트리밍 시작 전에 상태·헤더를 한 번에 확정해야 하므로 직접 쓰기를 막는다. 상태 변경은 throw 로만 한다.

```ts
export function redirect(to: string, status?: 301 | 302 | 303 | 307 | 308): never; // 기본 302
export function notFound(): never;                                                    // 404
export function httpError(status: number, message?: string): never;
```

### 3.4 훅·컴포넌트 (`ssr-kit`, 서버·클라 공용)

| API | 설명 |
|---|---|
| `useLoaderData<typeof loader>()` | 현재 라우트 로더 데이터 |
| `useRouteLoaderData<typeof loader>(id)` | 다른(상위) 라우트 데이터 |
| `useParams()` / `useLocation()` | 현재 매칭 정보 |
| `useNavigate()` | `navigate(to, { replace?, state? })` |
| `useNavigation()` | `{ state: 'idle' \| 'loading', location? }` — 전역 로딩 표시용 |
| `useRevalidate()` | 현재 로더 재실행 |
| `useRequestContext()` | 서버: `AppContext`, 클라: `null` |
| `<Link to prefetch="intent" \| "viewport" \| "none">` | 기본 `"intent"`(hover·focus·touchstart) |
| `<Outlet />` | 자식 라우트 렌더 위치 |

### 3.5 서버 핸들러 (`ssr-kit/node`)

```ts
export interface SsrHandlerOptions {
  /** 빌드 산출물 `dist/server/entry.js` 의 build 객체 또는 dev 에서 받은 객체 */
  build: ServerBuild;
  /** 로더 context 생성. 기본 () => ({}) */
  getContext?: (req: IncomingMessage) => AppContext | Promise<AppContext>;
  /** R3. 기본: 간단 UA 정규식. false 면 항상 스트리밍 */
  isBot?: ((req: IncomingMessage) => boolean) | false;
  /** R4. ms, 기본 10_000 */
  renderTimeout?: number;
  /** A3. 요청별 nonce */
  getNonce?: (req: IncomingMessage) => string | undefined;
  /** E3 */
  onError?: (error: unknown, info: { req: IncomingMessage; phase: ErrorPhase }) => void;
  /** Q2. 기본 '/_data' */
  dataPrefix?: string;
}

export type ErrorPhase = 'loader' | 'shell' | 'stream' | 'data';

export function createSsrHandler(opts: SsrHandlerOptions):
  (req: IncomingMessage, res: ServerResponse, next?: (err?: unknown) => void) => Promise<void>;
```

- 매칭되는 라우트가 없으면 `next` 가 있으면 `next()`, 없으면 루트 404 렌더. → Express 에서 뒤에 다른 핸들러를 둘 수 있다.
- 핸들러는 정적 파일을 서빙하지 않는다. `dist/client` 는 사용자가 `express.static` 등으로 서빙한다(예제에 포함).

### 3.6 사용자 서버 예시 (dev/prod 공용)

```ts
// server.ts
import express from 'express';
import { createSsrHandler } from 'ssr-kit/node';

const app = express();
const isProd = process.env.NODE_ENV === 'production';

if (isProd) {
  app.use('/assets', express.static('dist/client/assets', { immutable: true, maxAge: '1y' }));
  const { build } = await import('./dist/server/entry.js');
  app.use(createSsrHandler({ build }));
} else {
  const { createDevServer } = await import('ssr-kit/vite');
  const dev = await createDevServer({ root: process.cwd() });
  app.use(dev.middlewares);                                   // Vite HMR·에셋
  app.use((req, res, next) =>
    createSsrHandler({ build: dev.getBuild() })(req, res, next)); // 요청마다 최신 모듈
}

app.listen(3000);
```

## 4. 라우트 매칭

### 4.1 패턴 문법 (RT2)

| 세그먼트 | 의미 | 예 |
|---|---|---|
| `abc` | 정적 | `/gold` |
| `:id` | 동적, `/` 제외 1개 이상 문자 | `/gold/:id` |
| `:lang?` | 옵셔널 동적 | `/:lang?/about` |
| `*` | 나머지 전부(마지막 세그먼트만) → `params['*']` | `/files/*` |

- 경로는 `decodeURIComponent` 후 비교, 끝 `/` 는 무시. 대소문자 구분.
- 매칭 결과는 루트부터 리프까지 `RouteMatch[]` (중첩 레이아웃 포함).

### 4.2 우선순위

후보가 여럿이면 세그먼트별 점수 합이 큰 쪽: 정적 10 > 동적 3 > 옵셔널 2 > `*` 1. 동점이면 정의 순서. 빌드 시점이 아니라 `defineRoutes` 호출 시 한 번 정렬된 테이블을 만든다.

### 4.3 타입 추론

`Params<'/gold/:id/:tab?'>` → `{ id: string; tab?: string }` 를 템플릿 리터럴 타입으로 구현. `*` → `{ '*': string }`.

## 5. 서버 요청 처리

### 5.1 문서 요청 흐름

```
1  url = new URL(req.url, origin)
2  url.pathname 이 dataPrefix 로 시작 → §5.6
3  matches = match(url.pathname)        없음 → next() 또는 404
4  modules = await Promise.all(matches.map(m => m.route.module()))
5  ctx = await getContext(req)
6  results = await Promise.allSettled(로더 있는 매치마다 loader(args))   ← D2 병렬
7  redirect throw 가 하나라도 있으면 → 가장 상위 매치의 redirect 로 응답, 종료
8  에러 처리 → §5.5 로 errorIndex, status 결정
9  status/headers 확정 (§5.4)
10 head = mergeHead(...)               (§5.7)
11 renderToPipeableStream(<Document> … </Document>, { bootstrapModules, nonce, onShellReady, onAllReady, onShellError, onError })
12 isBot ? onAllReady 에서 pipe : onShellReady 에서 pipe
13 setTimeout(renderTimeout) → abort()  (미완료 Suspense 는 클라 렌더로 넘어감)
```

- 6 의 로더들은 같은 `AbortController` 의 `signal` 을 받는다. `req.on('close')` 시 abort.
- 4 와 6 은 병렬화하지 않는다. 모듈 로드는 캐시되어 사실상 0 비용이고, 순서를 단순하게 둔다.

### 5.2 스트리밍된 데이터 (R2, P1)

로더가 반환 객체 안에 Promise 를 담으면 그대로 스트리밍한다.

```ts
export const loader = async () => ({ gold: await getGold(), chart: getChart() /* Promise */ });
// 컴포넌트: const chart = use(useLoaderData<typeof loader>().chart)  (Suspense 경계 안)
```

- 직렬화기(§7)가 Promise 를 만나면 ID 를 부여하고 자리표시자를 넣는다.
- resolve 되면 `<script>__SSRK.r(id, value)</script>` 청크를 스트림에 추가, reject 면 `__SSRK.j(id, error)`.
- 클라 데이터 엔드포인트(§5.6)에서는 v1 에서 Promise 를 **기다렸다가** 한 번에 보낸다(NDJSON 스트리밍은 P2).

### 5.3 SPA 셸 (R6)

리프 매치 기준 상위 어딘가에 `ssr: false` 가 있으면 로더·렌더를 건너뛰고 `Document` 만 렌더해 `<div id="root"></div>` + 부트스트랩 스크립트를 보낸다. 클라는 `createRoot` 로 마운트 후 데이터 엔드포인트를 호출한다.

### 5.4 상태·헤더 병합

- **상태:** 에러가 없으면 200. 에러면 §5.5 결과. `notFound()` → 404.
- **헤더:** 루트 → 리프 순서로 각 로더의 `headers` 를 덮어쓴다. **같은 헤더는 더 깊은 라우트가 이긴다.** 예외: `Set-Cookie` 는 전부 append.
- `Cache-Control` 을 아무도 설정하지 않으면 `private, no-store` 를 기본으로 붙인다. (P2 대응 — 실수로 개인화된 HTML 이 CDN 에 캐시되는 걸 막는 쪽이 기본)
- 프레임워크가 그 외 캐시 헤더를 추가하지 않는다.

### 5.5 에러 처리 (E1, E2)

| 상황 | 처리 | 상태 |
|---|---|---|
| 로더 `httpError(s)` / `notFound()` | 해당 매치부터 위로 가장 가까운 `ErrorBoundary` 렌더. 그 아래 라우트는 렌더 안 함 | s / 404 |
| 로더 일반 Error | 위와 같음. `onError(err, { phase: 'loader' })` | 500 |
| 여러 로더 실패 | **가장 상위** 실패 매치 기준 | 그 에러의 상태 |
| `ErrorBoundary` 를 가진 상위 라우트 없음 | 기본 루트 에러 UI (`Document` + 상태 코드·메시지, prod 에선 메시지 숨김) | 그대로 |
| 셸 렌더 중 throw (`onShellError`) | 스트림 폐기 후 기본 루트 에러 UI 를 `renderToString` 으로 재렌더 | 500 |
| 셸 이후 Suspense 내부 throw | React 가 해당 경계를 클라 렌더로 전환. `onError(phase: 'stream')` 만 호출 | 이미 전송된 상태 유지 |

`RouteError` 타입:
```ts
export interface RouteError { status: number; message: string; /** dev 에서만 */ stack?: string }
```
서버→클라로 보낼 때 prod 에서는 `message` 를 `status` 별 기본 문구로 바꾼다(일반 Error 의 내부 메시지 노출 방지). `httpError(status, message)` 로 명시한 메시지는 유지.

### 5.6 데이터 엔드포인트 (D6)

```
GET /_data/gold/1?tab=chart
→ 200 application/json
```

```ts
type DataResponse =
  | { type: 'data'; matches: { id: string; data: Serialized }[]; head: HeadTags }
  | { type: 'redirect'; to: string; status: number }
  | { type: 'error'; matchId: string; error: RouteError };
```

- 요청 헤더 `X-SSRK-Routes: root,gold-layout` 로 클라가 **이미 가진 상위 라우트 ID** 를 보내면, 서버는 그 라우트 로더를 건너뛴다(같은 레이아웃 안 이동 시 레이아웃 로더 재실행 방지). `useRevalidate()` 는 헤더 없이 보내 전부 재실행.
- redirect 도 HTTP 200 + `type: 'redirect'` 로 보낸다. fetch 가 자동으로 따라가 데이터 요청이 문서 URL 로 바뀌는 걸 막기 위함.
- 응답 헤더는 §5.4 규칙 그대로(캐시 정책을 문서와 동일하게 적용). `Vary: X-SSRK-Routes` 추가.
- CSRF: GET 만 허용, 로더는 읽기 전용이라는 전제. 그 외 메서드는 405.

### 5.7 head 병합 (A1)

```ts
export interface HeadTags {
  title?: string;
  meta?: Array<{ name?: string; property?: string; content: string; [k: string]: string | undefined }>;
  link?: Array<{ rel: string; href: string; [k: string]: string | undefined }>;
}
```
- 루트 → 리프 순서로 병합. `title` 은 마지막 값. `meta` 는 `name ?? property ?? charset` 키로 중복 제거(깊은 쪽이 이김). `link` 는 `rel+href` 로 중복 제거 후 append.
- 에러 시에는 에러 경계 라우트까지의 head 만 사용.
- React 19 의 컴포넌트 내 `<title>`/`<meta>` 호이스팅도 막지 않는다. 둘을 같이 쓰면 중복될 수 있다고 문서화.

### 5.8 Document (A4)

```tsx
export interface DocumentProps {
  head: React.ReactNode;    // 병합된 head 태그 + 에셋 link
  children: React.ReactNode; // 앱 루트
  nonce?: string;
}
// 기본 구현
export const DefaultDocument = ({ head, children }: DocumentProps) => (
  <html lang="ko">
    <head><meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />{head}</head>
    <body><div id="root">{children}</div></body>
  </html>
);
```
하이드레이션 대상은 `#root` 내부만이다(`hydrateRoot(document.getElementById('root'), …)`). `<html>` 전체 하이드레이션을 하지 않는 이유: 브라우저 확장·WebView 주입 스크립트가 `<head>`/`<body>` 를 건드려 생기는 불일치를 피한다.

## 6. Vite 플러그인 (`ssr-kit/vite`)

### 6.1 옵션

```ts
export interface SsrKitPluginOptions {
  routes: string;          // routes 파일 경로
  document?: string;       // Document 컴포넌트 파일 경로
  dataPrefix?: string;     // 런타임 옵션과 일치해야 함, 기본 '/_data'
}
```

### 6.2 빌드 구성 (B1, B5)

Vite Environment API 로 `client`, `ssr` 두 환경을 정의하고 `builder.buildApp` 에서 순서대로 빌드한다.

| 환경 | 엔트리 | 출력 | 비고 |
|---|---|---|---|
| client | `virtual:ssr-kit/client-entry` | `dist/client/` + `.vite/manifest.json` | `build.manifest: true` |
| ssr | `virtual:ssr-kit/server-entry` | `dist/server/entry.js` | client manifest 를 JSON 으로 인라인 |

가상 모듈:
```ts
// virtual:ssr-kit/client-entry
import { hydrate } from 'ssr-kit/client';
import routes from '/src/routes.ts';
hydrate(routes);

// virtual:ssr-kit/server-entry
import routes from '/src/routes.ts';
import Document from '/src/Document.tsx';
import manifest from 'virtual:ssr-kit/manifest';
export const build = { routes, Document, manifest, dataPrefix: '/_data' };
```

`RouteDef.module` 은 `() => import('./x')` 형태의 **정적 문자열 import 만** 허용한다. 플러그인이 `routes` 파일을 파싱해 각 라우트의 모듈 ID 를 수집하고(`routeId → moduleId` 표), 이 표로 매니페스트 조회와 프리패치를 한다. 동적 경로(`import(variable)`)는 빌드 에러.

### 6.3 서버 코드 제거 (B2)

클라이언트 환경 `transform` 훅에서, 6.2 에서 수집한 라우트 모듈에 대해:

1. `oxc-parser` 로 파싱해 `export const loader` / `export function loader` / `export { loader }` 를 찾는다.
2. 해당 선언을 제거한다(`magic-string`).
3. 제거 후 더 이상 참조되지 않는 import 바인딩을 제거한다. 남은 바인딩이 없는 import 문은 통째로 제거(사이드이펙트 import `import 'x'` 는 유지).
4. 소스맵 유지.

추가 안전장치:
- 파일명이 `*.server.ts(x)` 이거나 경로에 `/server/` 디렉토리가 포함된 모듈이 client 환경 그래프에 들어오면 **빌드 에러** (import 체인 출력).
- 빌드 후 검사: client 번들 텍스트에 `loader` 제거 대상 모듈의 서버 전용 import 식별자가 남아 있으면 경고 (NFR 보안 항목).

서버 환경에서는 변환 없음.

### 6.4 에셋 매니페스트 (A2)

```ts
interface AssetManifest {
  entry: { file: string; css: string[] };                        // client-entry
  routes: Record<string, { file: string; imports: string[]; css: string[] }>; // routeId 기준, imports 는 재귀 평탄화
}
```
- 문서 응답 시 매치된 라우트들의 `file`·`imports` 를 `<link rel="modulepreload">`, `css` 를 `<link rel="stylesheet">` 로 head 에 넣는다. 중복 제거.
- 클라 `<Link>` 프리패치 시에도 같은 매니페스트를 사용(클라 번들에 routes 부분만 인라인, 경로·파일명만이라 작음).
- 모든 URL 앞에 Vite `base` 를 붙인다.

### 6.5 dev (B3, E4)

```ts
export function createDevServer(opts: { root: string; configFile?: string }): Promise<{
  middlewares: import('connect').Server;   // vite.middlewares
  getBuild: () => ServerBuild;             // 요청 시점 최신 모듈
  close: () => Promise<void>;
}>;
```
- 내부에서 `createServer({ server: { middlewareMode: true }, appType: 'custom' })`.
- `getBuild` 는 `server.environments.ssr` 의 모듈 러너로 `virtual:ssr-kit/server-entry` 를 import. 러너가 모듈 그래프 무효화를 처리하므로 서버 코드 수정이 다음 요청에 반영된다.
- dev 매니페스트는 실제 파일 대신 `/@id/...` 모듈 URL 을 그대로 쓰고, `@vite/client` 와 React Refresh 프리앰블을 head 에 주입한다.
- 로더·렌더 에러는 `server.ssrFixStacktrace` 후 `server.ws.send({ type: 'error' })` 로 Vite 오버레이에 띄운다.
- CSS FOUC: dev 에서는 매치된 라우트 모듈의 모듈 그래프를 따라 CSS 모듈을 찾아 `<style>` 로 인라인한다.

### 6.6 브라우저 타겟 (B4)

플러그인은 `build.target` 을 건드리지 않는다. 런타임 클라 코드는 ES2020 문법 + 다음 API 만 사용한다: `fetch`, `AbortController`, `history.pushState`, `IntersectionObserver`(viewport 프리패치, 없으면 비활성), `requestIdleCallback`(없으면 `setTimeout`). Navigation API·`structuredClone` 미사용 — 구형 Android WebView 대응.

## 7. 직렬화 (D3)

자체 구현, 의존성 0.

- 지원: JSON 기본형, `undefined`, `Date`, `Map`, `Set`, `BigInt`, `RegExp`, `URL`, `NaN`/`±Infinity`/`-0`, 순환·공유 참조, `Promise`(§5.2).
- 미지원(직렬화 시 throw, dev 에서 경로 표시): 함수, 클래스 인스턴스(`Date`·`Map` 등 위 목록 제외), `Symbol`.
- 형식: `[값 테이블]` 평탄화 + 인덱스 참조 (devalue 와 같은 계열). 파싱은 `JSON.parse` 후 복원 — `eval` 없음.
- 인라인 출력: `<script nonce>window.__SSRK=…</script>` 에서 문자열을 JSON 으로 다시 감싸고 `<` → `<`, ` `, ` ` 이스케이프.
- 크기 경고: dev 에서 문서 1개당 직렬화 결과가 100KB 를 넘으면 콘솔 경고(라우트 ID 표시).

## 8. 클라이언트 런타임 (`ssr-kit/client`)

### 8.1 hydrate

```ts
export function hydrate(routes: RouteDef[], opts?: { onRecoverableError?: (e: unknown) => void }): void;
```
1. `window.__SSRK` 에서 매치 ID, 로더 데이터, 에러 상태, 매니페스트 읽기.
2. 매치된 라우트 모듈을 `Promise.all` 로 import (이미 modulepreload 됨).
3. `hydrateRoot(#root, <Router initial=… />)`.
4. 하이드레이션 불일치(R5, P1): dev 에서 `onRecoverableError` 를 가로채 서버 HTML(`#root` 의 hydrate 전 `innerHTML` 스냅샷)과 첫 클라 렌더 HTML 을 줄 단위 diff 로 콘솔 출력.

### 8.2 네비게이션

```
navigate(to)
1  이전 진행 중 네비게이션 abort
2  matches = match(to)   없음 → 전체 문서 이동(location.assign)
3  state = 'loading'
4  병렬: 라우트 모듈 import + (로더 있는 매치가 있으면) GET {dataPrefix}{to}  X-SSRK-Routes: 공유 상위 ID
5  응답 type
     redirect → 내부 경로면 navigate(to, { replace: true }), 외부면 location.assign
     error    → 해당 matchId 의 ErrorBoundary
     data     → 데이터 병합
6  history.pushState / replaceState
7  startTransition(() => setState(new matches, data))  — 이전 화면 유지하다 교체
8  head 적용: document.title, meta/link 는 data-ssrk 속성 붙은 태그만 교체
9  스크롤: 해시 있으면 해당 요소, 아니면 top. state='idle'
```
- `popstate`: 같은 흐름이되 6 생략, 스크롤은 `sessionStorage` 에 키별로 저장해 둔 위치 복원(`history.scrollRestoration = 'manual'`).
- 데이터 요청이 네트워크 에러면 전체 문서 이동으로 폴백(서버 렌더로 다시 시도).
- 데이터 캐시 없음. 같은 경로 재방문도 다시 요청한다(G2: 캐시는 HTTP 레벨에서). 단, `intent` 프리패치 결과는 해당 네비게이션 1회에 한해 재사용(최대 10초).

### 8.3 프리패치 (RT4)

| 모드 | 트리거 | 가져오는 것 |
|---|---|---|
| `intent` (기본) | `mouseenter` 100ms 유지, `focus`, `touchstart` | 라우트 모듈(`modulepreload` 링크 삽입) + 데이터 |
| `viewport` | `IntersectionObserver` 진입 | 라우트 모듈만 (데이터 제외 — 과다 요청 방지) |
| `none` | — | — |

### 8.4 Link

- 렌더 결과는 일반 `<a href>`. JS 비활성·하이드레이션 전에도 동작.
- 가로채지 않는 경우: 수정 키(ctrl/meta/shift/alt), `target` 지정, `download`, 외부 origin, 우클릭.

## 9. 어댑터

| 어댑터 | 시그니처 | 단계 |
|---|---|---|
| `ssr-kit/node` | `(req: IncomingMessage, res: ServerResponse, next?) => Promise<void>` — Express·Connect·Polka 그대로 | P0 |
| `ssr-kit/fastify` | `fastify.register(ssrKitPlugin, opts)` — `reply.hijack()` 후 `reply.raw` 로 pipe | P1 |
| `ssr-kit/hono` | `(c) => Response` — `renderToReadableStream` 경로 | P1 |
| `ssr-kit/web` | `(request: Request) => Promise<Response>` | P2 |

코어(`core/`·`server/`)는 요청을 `{ url, method, headers, raw }` 로 추상화한 `SsrRequest` 를 받는다. 어댑터는 이 변환과 응답 쓰기만 담당한다. Node 어댑터는 `renderToPipeableStream`, Web 계열은 `renderToReadableStream` 을 쓴다 — 렌더러 선택은 `server/` 안에서 `createRenderer('node' | 'web')` 로 분기.

## 10. 보안

| 항목 | 대응 |
|---|---|
| 직렬화 XSS | §7 이스케이프, 직렬화 결과 `innerHTML` 로 쓰지 않음 |
| 로더 코드 유출 | §6.3 제거 + `*.server` 그래프 차단 + 빌드 후 검사 |
| 에러 메시지 노출 | prod 에서 일반 Error 메시지·스택 미전송 (§5.5) |
| 개인화 HTML 캐시 | 기본 `Cache-Control: private, no-store` (§5.4) |
| CSP | `getNonce` → 부트스트랩·데이터 인라인 스크립트에 nonce (P1) |
| 오픈 리다이렉트 | `redirect()` 는 값 검증 안 함 — 사용자 책임으로 문서화. 데이터 응답의 외부 redirect 는 클라에서 `location.assign` |
| 경로 조작 | `decodeURIComponent` 실패 시 400, `..` 세그먼트 매칭 대상 아님 |

## 11. 성능 예산

PRD §8 을 측정 가능한 형태로 고정한다.

| 지표 | 측정 방법 | 기준 |
|---|---|---|
| 서버 런타임 크기 | `dist/server`+`dist/core`+`dist/adapters/node` min | < 30KB |
| 클라 런타임 크기 | `examples/express-basic` 의 ssr-kit 청크 min+gz | < 8KB |
| SSR 오버헤드 | autocannon, 같은 컴포넌트를 순수 `renderToPipeableStream` 서버와 비교, p50 TTFB | +5ms 이내 |
| dev cold start | 100 라우트 생성 픽스처, 서버 시작 → 첫 응답 | < 1.5s |

CI 에서 크기 2개는 매 PR 측정, 기준 초과 시 실패. 나머지는 릴리스 전 수동 벤치.

## 12. 테스트 전략

| 레벨 | 대상 | 도구 |
|---|---|---|
| 단위 | 매칭·우선순위, 직렬화 왕복(퍼징 포함), head 병합, 헤더 병합, 에러 경계 선택 | Vitest |
| 변환 | §6.3 loader 제거 — 입력/출력 스냅샷, import 정리, 소스맵 | Vitest + 픽스처 |
| 통합 | 핸들러에 가짜 req/res → 상태·헤더·HTML 스트림 청크 검증, 데이터 엔드포인트 응답 | Vitest + `node:http` |
| E2E | 예제 앱: 첫 렌더·하이드레이션·Link 이동·redirect·404·에러 경계·뒤로가기 스크롤 | Playwright (Chromium, WebKit) |
| 호환 | `webview-legacy-android` 예제를 구형 Android WebView 실기기에서 수동 확인 | 체크리스트 |

커버리지 목표: `core/`·`server/` 90% 이상 (PRD §8).

## 13. M1 작업 분해

| # | 작업 | 산출물 | 관련 ID |
|---|---|---|---|
| 1 | 모노레포·빌드(tsdown)·Vitest·CI 세팅 | 빈 패키지 배포 가능 상태 | — |
| 2 | 라우트 매칭 + 타입 | `core/match.ts` | RT1, RT2 |
| 3 | 직렬화기 | `core/serialize.ts` | D3 |
| 4 | 로더 실행·redirect/에러·헤더 병합 | `core/loaders.ts` | D1, D2, D4, E1 |
| 5 | head 병합 + Document | `core/head.ts` | A1, A4 |
| 6 | 서버 렌더러 + Node 핸들러 | `server/`, `adapters/node.ts` | R1, R4, E2, E3, AD1 |
| 7 | 데이터 엔드포인트 | `server/data.ts` | D6 |
| 8 | Vite 플러그인: 환경 빌드·가상 엔트리·매니페스트 | `vite/plugin.ts` | B1, B5, A2 |
| 9 | Vite 플러그인: loader 제거 변환 | `vite/strip.ts` | B2 |
| 10 | dev 서버 | `vite/dev.ts` | B3 |
| 11 | 클라: hydrate·Router·Link·네비게이션·훅 | `client/` | RT3, RT4 |
| 12 | `examples/express-basic` + Playwright E2E | 예제·테스트 | — |

순서: 1 → (2, 3, 5 병렬) → 4 → 6 → 7 → 8 → 9 → 10 → 11 → 12. 6 까지는 Vite 없이 수동 번들로 테스트한다.

## 14. 아직 남은 결정 (M1 중 확정)

1. 기본 `isBot` 정규식 범위 — 검색엔진·SNS 미리보기 봇 목록.
2. 루트 404(매치 없음) 를 사용자 커스텀하는 방법 — `path: '*'` 라우트로 충분한지.
3. `useNavigation` 에 `formData` 류 확장을 열어둘지 — v1 은 mutation 비목표라 보류.
4. 라이브러리 빌드 도구 tsdown vs tsup.
