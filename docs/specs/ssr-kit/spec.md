# ssr-kit 기술 스펙

- 작성: 안승찬 · 2026-11-11
- 상태: v0.6 (라우트 미들웨어·Server-Timing 추가, 2026-11-11)
- 근거: [ssr-kit-prd.md](../../prd/ssr-kit-prd.md) v0.1 — 요구사항 ID(R1, RT1, D1 …)는 PRD 표기를 그대로 쓴다.
- 범위: M1(MVP, P0) 구현에 필요한 결정 전부 + P1 은 인터페이스만 고정.
- 기준 버전: React 19.3 · Vite 8.3 · @vitejs/plugin-react 6.3 · Node 22+

---

## 0. 결정 기록

### 0.1 PRD 미결 질문

| PRD §13 | 결정 | 이유 |
|---|---|---|
| Q2 데이터 엔드포인트 | **경로 prefix 방식** `GET /_data/<원래 경로>?<원래 쿼리>` (prefix 설정 가능) | CDN·리버스 프록시에서 경로 규칙만으로 캐시·라우팅 분리 가능 |
| Q3 로더 타입 추론 | **`typeof loader` 제네릭** — `useLoaderData<typeof loader>()` | 라우트 ID 레지스트리는 코드 생성이 필요해 G7(얇은 코어)과 충돌 |
| Q4 클라이언트 라우터 | **자체 최소 라우터** + 외부 라우터용 저수준 `render()` (RT6, §3.7) | 로더·스트리밍·head 와 맞물리는 부분이라 외부 위임 시 접착 코드가 더 커짐 |

### 0.2 PRD 와 달라지는 점

로더는 `defineRoutes` 인라인이 아니라 **라우트 모듈 파일의 named export** 로 둔다. 인라인이면 `routes.ts` 가 클라 번들에 들어가며 로더가 import 한 서버 코드가 같이 딸려간다. 파일 단위면 빌드 시 `loader` export 를 정적 분석으로 제거할 수 있다(§6.3).

### 0.3 v0.1 검증 반영 (2026-11-11)

| # | v0.1 문제 | v0.2 결정 | 반영 위치 |
|---|---|---|---|
| V1 | 서버는 `<html>` 전체, 클라는 `#root` 만 hydrate → `useId` 트리 위치 불일치 | **document 전체 hydrate**. React 19 는 `<head>`/`<body>` 의 낯선 태그(확장·WebView 주입)를 건너뜀 | §5.8, §8.1 |
| V2 | `X-SSRK-Routes` 로 상위 로더 생략 → 클라가 헤더 조작 시 상위 로더의 인증 검사 우회 | **v1 에서 로더 생략 제거**. 인증은 `getContext`·사용자 미들웨어 또는 **라우트 `middleware`**(§5.9 — 문서·데이터 요청마다 매치 전부 실행)에서. 로더에 인증을 두지 않는다 | §5.6, §5.9 |
| V3 | 클라 번들에 매니페스트 인라인 — client 가 먼저 빌드돼 해시를 알 수 없음 | 클라 매니페스트 없음. 프리패치는 `route.module()` 호출(Vite preload helper 가 CSS·의존 청크 처리) | §6.4, §8.3 |
| V4 | `getBuild()` 동기 시그니처 vs 모듈 러너 `import()` 비동기 | `getBuild(): Promise<ServerBuild>` | §3.6, §6.5 |
| V5 | 라우트 모듈의 비컴포넌트 export(`loader`, `head`) → React Refresh 경계 실패 → dev 전체 리로드 | M1 은 전체 리로드 허용·문서화, Fast Refresh 보존은 P1 요구사항 | §6.5 |
| V6 | `LoaderArgs.request` 가 `IncomingMessage` → Hono/Web 어댑터와 충돌 | 공통 `SsrRequest`(`url`, `method`, `headers: Headers`, `raw`) | §3.3, §9 |
| V7 | Vite peer `^6 \|\| ^7` | **`^8`** (현재 8.3.8) | §1 |
| V8 | loader 제거 변환 순서 미정 → 타입 참조를 값 참조로 오인 | 일반 순서(Vite 내장 TS 변환 이후, JS 대상) | §6.3 |
| V9 | Promise 스트리밍 시 React 출력 중간에 `<script>` 삽입 위치 미정 | React 가 `write` 한 청크 사이에만 삽입하는 Transform | §5.2 |
| V10 | 배포 직후 구 클라가 사라진 청크 import 실패 | 모듈 로드 실패 시 문서 이동 폴백 | §8.2 |
| V11 | 자체 hydration diff(R5) — React 19 가 dev 에서 이미 diff 출력 | 자체 diff 제거, React 에러 콜백을 `onError` 로 연결만 | §8.1 |
| V12 | 예시가 `/assets` 만 서빙 → `public/` 누락 | `dist/client` 전체 서빙 | §3.6 |
| V13 | RT6 `render()` 인터페이스 누락 | 추가 | §3.7 |
| V14 | head·에셋을 클라에서도 같은 마크업으로 렌더해야 hydrate 일치 | head 는 클라가 `head()` 를 재계산, 에셋·데이터는 React 트리 밖(`preinit*`, `bootstrapScriptContent`) | §5.7, §6.4, §7 |

## 1. 저장소 구조

WebViewKit 레포와 같은 구성: 루트는 private 워크스페이스, 배포 패키지 1개 + 예제 앱 패키지.

```
ssr-kit/
├─ package.json              # name: ssr-kit-monorepo, private, --filter 스크립트
├─ pnpm-workspace.yaml       # packages/*
├─ tsconfig.base.json
├─ eslint.config.mjs · .prettierrc
├─ .github/workflows/ci.yml  # install → lint → typecheck → test → build → example build·E2E
├─ docs/
│  ├─ prd/ssr-kit-prd.md
│  └─ specs/ssr-kit/spec.md
└─ packages/
   ├─ core/                  # 배포 패키지 `ssr-kit`
   │  ├─ src/
   │  │  ├─ index.ts         # 공용(서버·클라) API
   │  │  ├─ core/            # 매칭·직렬화·로더·head·에러 (의존성 0)
   │  │  ├─ react/           # Router 컨텍스트·훅·Outlet·Link·Head (서버·클라 공용)
   │  │  ├─ server/          # 렌더러, 문서·데이터 요청 처리
   │  │  ├─ client/          # hydrate, 네비게이션
   │  │  ├─ node/            # Node 어댑터
   │  │  └─ vite/            # Vite 플러그인, dev 서버 (빌드 타임 의존성 허용)
   │  ├─ tsup.config.ts
   │  └─ vitest.config.ts
   └─ example/               # Express 예제 앱 (`workspace:*`), E2E
```

```jsonc
// packages/core/package.json (발췌)
{
  "name": "ssr-kit",
  "type": "module",
  "exports": {
    ".":        { "types": "./dist/index.d.ts",  "default": "./dist/index.js" },
    "./server": { "types": "./dist/server.d.ts", "default": "./dist/server.js" },
    "./client": { "types": "./dist/client.d.ts", "default": "./dist/client.js" },
    "./node":   { "types": "./dist/node.d.ts",   "default": "./dist/node.js" },
    "./vite":   { "types": "./dist/vite.d.ts",   "default": "./dist/vite.js" },
    "./package.json": "./package.json"
  },
  "peerDependencies": { "react": "^19", "react-dom": "^19", "vite": "^8" },
  "peerDependenciesMeta": { "vite": { "optional": true } },
  "engines": { "node": ">=22" }
}
```

- 빌드: **tsup, ESM 전용**. Vite 8 플러그인·Node 22 는 ESM 이 기본이라 CJS 를 내지 않는다.
- 테스트: Vitest(단위·통합) + Playwright(E2E, `packages/example`).
- `vite` 엔트리만 빌드 타임 의존성(`oxc-parser`, `magic-string`)을 가진다. 나머지 엔트리는 런타임 의존성 0 (G7).

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
  /** 생략 시 부모 id + 인덱스로 생성. 전체에서 유일해야 함 */
  id?: string;
  /** `/gold/:id`, `/files/*`, `/:lang?/about`. 생략 = pathless 레이아웃 */
  path?: string;
  /** 라우트 모듈 lazy import. 반드시 `() => import('리터럴')` 형태 (§6.2) */
  module: () => Promise<RouteModule>;
  children?: RouteDef[];
  /** R6. false 면 이 라우트 이하 SPA 셸만 응답 */
  ssr?: boolean;
}

export function defineRoutes(routes: RouteDef[]): RouteDef[];
```

### 3.2 라우트 모듈

```tsx
// src/pages/GoldDetail.tsx
import type { LoaderArgs, HeadArgs, RouteError } from 'ssr-kit';
import { useLoaderData, notFound } from 'ssr-kit';

export const loader = async ({ params, request, headers, signal }: LoaderArgs<'/gold/:id'>) => {
  const res = await fetch(`${API}/gold/${params.id}`, {
    headers: { cookie: request.headers.get('cookie') ?? '' },
    signal,
  });
  if (res.status === 404) notFound();
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
| `middleware` | **서버 전용** | X | 함수 또는 배열. 로더보다 먼저 실행 (§5.9). 클라 번들에서 제거 |
| `action` | **서버 전용** | X | POST·PUT·PATCH·DELETE 처리 (§3.8). 클라 번들에서 제거 |
| `head` | 서버·클라 | X | 클라 이동·hydrate 시에도 실행 (§5.7) |
| `ErrorBoundary` | 서버·클라 | X | 이 라우트 이하 로더·렌더 에러 처리 |

### 3.3 로더 타입

```ts
/** 어댑터 공통 요청. raw 는 어댑터 원본(Node 면 IncomingMessage) */
export interface SsrRequest {
  url: URL;
  method: string;
  headers: Headers;
  raw: unknown;
  /** 어댑터가 넣는 본문 원천. action 의 request.formData() 등이 쓴다 (§3.8) */
  readBody?: () => Promise<Uint8Array | ArrayBuffer>;
}

export interface LoaderArgs<Path extends string = string> {
  params: Params<Path>;            // '/gold/:id' → { id: string }, ':lang?' → { lang?: string }
  request: SsrRequest;
  /** 응답 헤더 누적. 병합 규칙 §5.4 */
  headers: Headers;
  /** 클라 연결 종료·렌더 타임아웃 시 abort */
  signal: AbortSignal;
  /** 어댑터 `getContext` 반환값 */
  context: AppContext;
}

/** 사용자가 declaration merging 으로 확장 */
export interface AppContext {}

export type LoaderData<L> = L extends (...a: never[]) => infer R ? Awaited<R> : never;
export interface HeadArgs<L> { data: LoaderData<L>; params: Record<string, string | undefined> }
```

```ts
/** 라우트 미들웨어 (§5.9). context 는 이후 로더가 받는 것과 같은 객체 */
export interface MiddlewareArgs<Path extends string = string> {
  params: Params<Path>;
  request: SsrRequest;
  headers: Headers;   // 이 라우트 로더와 같은 객체 (§5.4 병합)
  signal: AbortSignal;
  context: AppContext;
}
export type Middleware = (args: MiddlewareArgs, next: () => Promise<void>) => Promise<void> | void;
```

- Node 원본이 필요하면 `ssr-kit/node` 의 `getNodeRequest(request): IncomingMessage` 를 쓴다(사용자 미들웨어가 붙인 `req.user` 등).
- `res` 는 넘기지 않는다. 스트리밍 전에 상태·헤더를 한 번에 확정해야 하므로 상태 변경은 throw 로만 한다.

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
| `useNavigate()` | `navigate(to, { replace?, state? })`. `to` 는 `Href`(§4.4) |
| `useNavigation()` | `{ state: 'idle' \| 'loading' \| 'submitting', location?, formMethod?, formData? }` |
| `useActionData<typeof action>()` | 마지막 action 반환값. 이동하면 사라짐 (§3.8) |
| `useSubmit()` | `submit(formData \| URLSearchParams \| Record, { method?, action?, replace? })` |
| `<Form method action? replace? reloadDocument?>` | 실제 `<form>` 렌더, hydrate 후 제출을 가로챔 (§8.5) |
| `useRevalidate()` | 현재 로더 재실행 |
| `useRequestContext()` | 서버: `AppContext`, 클라: `null` |
| `<Link to prefetch="intent" \| "viewport" \| "none">` | 기본 `"intent"`. `to` 는 `Href`(§4.4) |
| `<Outlet />` | 자식 라우트 렌더 위치 |
| `href(pattern, params)` | 패턴 → 주소 (§4.4) |
| `<Head />` | 병합된 head 태그 렌더 (Document 안) |

### 3.5 Node 핸들러 (`ssr-kit/node`)

```ts
export interface NodeHandlerOptions {
  /** prod: `dist/server/entry.js` 의 build, dev: `await dev.getBuild()` */
  build: ServerBuild;
  getContext?: (req: IncomingMessage) => AppContext | Promise<AppContext>;
  /** R3. 기본: 검색엔진·SNS 미리보기 UA 정규식. false 면 항상 스트리밍 */
  isBot?: ((req: IncomingMessage) => boolean) | false;
  /** R4. ms, 기본 10_000 */
  renderTimeout?: number;
  /** A3. 요청별 nonce */
  getNonce?: (req: IncomingMessage) => string | undefined;
  /** E3 */
  onError?: (error: unknown, info: { url: string; phase: ErrorPhase }) => void;
  /** Server-Timing 응답 헤더 (§5.10). 기본: build.dev */
  serverTiming?: boolean;
  /** 요청마다 측정값 (로깅용, §5.10) */
  onTiming?: (entries: TimingEntry[], info: { url: string }) => void;
  /** action CSRF 검사에서 요청 host 외에 허용할 origin (§3.8) */
  allowedOrigins?: string[];
}

export type ErrorPhase = 'middleware' | 'loader' | 'action' | 'shell' | 'stream' | 'data';
export interface TimingEntry { name: string; dur: number }

export function createSsrHandler(opts: NodeHandlerOptions):
  (req: IncomingMessage, res: ServerResponse, next?: (err?: unknown) => void) => Promise<void>;
export function getNodeRequest(request: SsrRequest): IncomingMessage;
```

- 매칭 라우트가 없으면 `next` 가 있으면 `next()`, 없으면 루트 404 렌더.
- `GET`·`HEAD` 외 메서드: 매치된 라우트(또는 상위)에 `action` 이 있으면 처리한다(§5.11). action 이 없거나 매치가 없거나 action 메서드(POST·PUT·PATCH·DELETE)가 아니면 `next()` (없으면 405) — 같은 경로의 사용자 API 라우트가 그대로 동작한다. web·edge·hono 의 `unmatched: 'next'` 도 같다.
- 정적 파일은 서빙하지 않는다 — 사용자가 `express.static` 등으로.

### 3.6 사용자 서버 예시 (dev/prod 공용)

```ts
// server.ts
import express from 'express';
import { createSsrHandler } from 'ssr-kit/node';

const app = express();

if (process.env.NODE_ENV === 'production') {
  app.use('/assets', express.static('dist/client/assets', { immutable: true, maxAge: '1y' }));
  app.use(express.static('dist/client', { index: false }));           // public/ 파일
  const { build } = await import('./dist/server/entry.js');
  app.use(createSsrHandler({ build }));
} else {
  const { createDevServer } = await import('ssr-kit/vite');
  const dev = await createDevServer({ root: process.cwd() });
  app.use(dev.middlewares);                                            // Vite HMR·에셋
  app.use(async (req, res, next) =>
    createSsrHandler({ build: await dev.getBuild() })(req, res, next)); // 요청마다 최신 모듈
}

app.listen(3000);
```

### 3.7 저수준 렌더 API (RT6)

외부 라우터(TanStack Router 등)를 쓸 때 매칭·로더를 건너뛰고 렌더·에셋·직렬화만 쓴다. `app` 은 `<html>` 을 포함한 **전체 문서**다(외부 라우터가 문서를 직접 그리는 경우가 많아 Document 로 감싸지 않는다).

```ts
// ssr-kit/server
export interface RenderOptions {
  request: SsrRequest;
  /** 렌더할 전체 트리 (<html> 포함) */
  app: React.ReactNode;
  /** 서버→클라 전달 값. §7 직렬화 */
  data?: unknown;
  /** 프리로드할 모듈 (매니페스트 키) */
  modules?: string[];
  status?: number;
  headers?: Headers;
  isBot?: boolean;
  renderTimeout?: number;
  nonce?: string;
  onError?: (error: unknown, info: { url: string; phase: ErrorPhase }) => void;
}
export function render(
  build: Pick<ServerBuild, 'bootstrapModules' | 'resolveAssets' | 'dev' | 'fixStacktrace'>,
  opts: RenderOptions,
  sink: RenderSink,
): Promise<void>;
// 클라: ssr-kit/client 의 readSsrData<T>() 로 data 를 읽고 사용자가 직접 hydrateRoot
```

### 3.8 데이터 변경 (action)

```tsx
// src/pages/Guestbook.tsx
import { type ActionArgs, Form, redirect, useActionData, useNavigation } from 'ssr-kit';

export const action = async ({ request, params, context, headers, signal }: ActionArgs<'/guestbook'>) => {
  const form = await request.formData();           // json() · text() 도 있음
  const message = String(form.get('message') ?? '').trim();
  if (!message) return { error: '내용을 입력해 주세요' }; // → useActionData()
  await save(message);
  redirect('/guestbook');                             // 303
};

export default function Guestbook() {
  const result = useActionData<typeof action>();
  const submitting = useNavigation().state === 'submitting';
  return (
    <Form method="post">
      <input name="message" />
      <button disabled={submitting}>남기기</button>
      {result?.error}
    </Form>
  );
}
```

```ts
export interface ActionRequest extends SsrRequest {
  formData(): Promise<FormData>;   // urlencoded·multipart
  json<T = unknown>(): Promise<T>;
  text(): Promise<string>;
}
export interface ActionArgs<Path extends string = string> extends Omit<LoaderArgs<Path>, 'request'> {
  request: ActionRequest;
}
export type ActionData<A> = A extends (...a: never[]) => infer R ? Awaited<R> : never;
```

- **실행 대상:** 매치 중 `action` 을 export 한 **가장 깊은** 라우트 하나(리프부터 위로).
- **본문:** 어댑터가 `readBody` 를 넣고, 처음 `formData()`/`json()`/`text()` 를 부를 때 한 번만 읽는다. 이후 호출은 같은 바이트를 다시 해석한다. 런타임별 원천: Node `IncomingMessage` 스트림, web·edge 원본 `Request`, Hono `c.req.raw`, Fastify `request.raw`(플러그인이 캡슐화한 하위 스코프에서 POST 계열 라우트의 content-type 파서를 passthrough 로 바꿔 Fastify 가 본문을 소비·거절하지 않게 한다. 사용자 라우트의 파서는 그대로).
- 앞선 미들웨어(Express `express.json()` 등)가 본문을 이미 읽었으면 빈 본문이 된다. 그 경우 `getNodeRequest(request).body` 를 쓴다.
- **CSRF:** `Origin`(없으면 `Referer`)의 host 가 요청 host 와 같아야 한다. 둘 다 없거나 `null` 이면 403. TLS 를 앞단에서 끝내면 요청 URL scheme 이 http 라 origin 전체가 아닌 host 를 비교한다. 프록시가 Host 를 바꾸면 어댑터 옵션 `allowedOrigins: ['https://app.example.com']`.
- **결과:** 반환값 → `payload.actionData` (로더 데이터와 같은 직렬화기, §7). 성공 후 매치된 로더 **전부**를 다시 실행해 같은 응답에 싣는다(클라가 재검증 요청을 따로 보내지 않음).
- **redirect:** `redirect()` 의 301·302 는 303 으로 바꾼다(브라우저가 GET 으로 따라감). 307·308 은 의도한 재전송이라 유지.
- **에러:** `httpError`/일반 Error 는 action 라우트부터 위로 가장 가까운 `ErrorBoundary` 와 그 상태(일반 Error 500, `onError(phase: 'action')`). 이때 로더는 action 라우트 **위쪽만** 실행한다. 더 위쪽 로더가 실패하면 그 에러가 우선.
- **헤더:** action `headers` 는 로더 헤더 위에 덮어쓴다(`Set-Cookie` 는 append). redirect 응답에도 실린다.
- 상태 코드는 성공 시 200 고정(검증 실패도 200 + actionData). action 이 상태를 정하는 API 는 v1 에서 보류.

## 4. 라우트 매칭

### 4.1 패턴 문법 (RT2)

| 세그먼트 | 의미 | 예 |
|---|---|---|
| `abc` | 정적 | `/gold` |
| `:id` | 동적, 비어 있지 않은 1세그먼트 | `/gold/:id` |
| `:lang?` | 옵셔널 동적 | `/:lang?/about` |
| `*` | 나머지 전부(마지막 세그먼트만) → `params['*']` | `/files/*` |

- 세그먼트별 `decodeURIComponent` 후 비교(실패 시 400). 끝 `/` 무시. 대소문자 구분.
- 자식 `path` 는 부모 기준 상대 경로. `/` 로 시작하면 절대 경로.
- 결과는 루트→리프 `RouteMatch[]` (pathless 레이아웃 포함). 리프는 자식이 없는 라우트.

### 4.2 우선순위

매치되는 브랜치들을 **URL 세그먼트 앞에서부터** 비교한다. 각 세그먼트를 소비한 패턴이 정적 > 동적 > 옵셔널 > `*` 순으로 구체적이다. 모두 같으면 비운 옵셔널·빈 `*` 가 적은 쪽, 그래도 같으면 정의 순서.

- 예: `/` 는 `*` 보다 인덱스 라우트, `/docs` 는 `/:lang?/docs` 보다 `/docs`.
- v0.3 까지의 점수 합산 방식은 `*`(1점)가 인덱스(0점)를 이기는 결함이 있어 바꿨다.

### 4.3 타입 추론

`Params<'/gold/:id/:tab?'>` → `{ id: string; tab?: string }`. `*` → `{ '*': string }`.

### 4.4 타입 안전 링크

옵트인. 등록하지 않으면 `Href = string` 이라 기존 코드는 그대로다.

```ts
// 사용자 또는 생성 파일이 확장한다
declare module 'ssr-kit' {
  interface Register { routes: '/' | '/gold/:id' | '/:lang?/about' | '/files/*' }
}

export type Href;                              // Link to · useNavigate() 인자
export function href<P extends RoutePattern>(pattern: P, params?: Params<P>): Href;
```

- **Href:** 등록된 패턴마다 템플릿 리터럴. `:id` → `${string}`, `:lang?` → 세그먼트 있음/없음 두 갈래,
  `*` → `/files` | `/files/${string}`. 각 갈래 뒤에 `?${string}`·`#${string}` 를 붙일 수 있다.
  쿼리·해시만 있는 주소(`?page=2`, `#top`)와 `http(s)://` 외부 URL 도 받는다(Link 는 다른 origin 을 가로채지 않는다).
- **href():** `:param` 은 `encodeURIComponent`, 비운 옵셔널은 세그먼트째 뺀다. `*` 는 `/` 로 나눠 조각마다 인코딩.
  필수 파라미터(`*` 포함)가 없으면 throw. 파라미터 타입은 §4.3 `Params<P>`.
- `redirect()` 는 `string` 그대로 둔다(서버는 외부·임의 경로로 보낼 수 있다).
- **생성:** `ssrKit({ routesDts: true | '경로' })`(기본 `.ssr-kit/routes.d.ts`, root 기준). routes 파일을 `oxc-parser` 로
  읽어 default/`routes` export 의 배열 리터럴(`defineRoutes(…)`·`as`·`satisfies`·최상위 const 식별자는 벗긴다)을 따라가며
  `path`·`children` 을 §4.1 규칙(상대 경로는 부모에 잇고 `/` 시작은 절대, pathless 는 부모 경로)으로 이어
  **리프 라우트만** 패턴으로 쓴다(매처의 flatten 과 같다). fsRoutes 생성 파일도 리터럴이라 그대로 읽힌다.
  - `path` 가 문자열 리터럴이 아니거나 spread·계산된 키·변수 children 이 있으면 경고 후 `routes: string` 을 쓴다(검사 끔, 낡은 패턴이 남지 않게).
  - `configResolved` 와 dev `watchChange`(routes 파일, fsRoutes 재생성 포함)에서 다시 만들고 내용이 같으면 쓰지 않는다.
- **적용:** tsconfig `include` 에 `".ssr-kit/routes.d.ts"` 를 파일로 넣는다. `typecheck` 가 `vite build` 보다 먼저 도는 CI 를 위해 생성 파일은 커밋을 권한다(예제 앱도 커밋).
- **TS 비용:** 갈래 수 = 패턴마다 2^(옵셔널 수) × 3(접미사). 패턴 50개·옵셔널 최대 3개 조합 타입 테스트에서 문제없다.
  옵셔널이 많은 패턴이 수백 개면 유니온이 커지므로 그때는 등록하지 않거나 패턴을 나눈다.

## 5. 서버 요청 처리

### 5.1 문서 요청 흐름

```
1  request = toSsrRequest(req)
2  pathname 이 dataPrefix 로 시작 → §5.6
3  matches = match(pathname)          없음 → next() 또는 404
4  ssr:false 가 경로에 있으면 → §5.3
5  modules = await Promise.all(matches.map(m => m.route.module()))
6  context = await getContext(req)
7  runMiddleware(루트 → 리프, onion, §5.9) — 맨 안쪽에서 8 을 실행
     redirect throw → 응답, 종료 / 에러 throw → 그 위쪽 로더만 실행, 9 로
8  results = await Promise.allSettled(로더 있는 매치마다 loader(args))   ← D2 병렬
   redirect 가 있으면 가장 상위 매치의 redirect 로 응답, 종료
9  에러 → §5.5 로 errorIndex·status 결정
10 status/headers 확정 (§5.4). serverTiming 이면 셸 직전에 Server-Timing (§5.10)
11 renderToPipeableStream(<Document><App/></Document>, {
     bootstrapModules: [clientEntry], bootstrapScriptContent: 직렬화 데이터(§7), nonce,
     onShellReady, onAllReady, onShellError, onError })
   렌더 중 매치 모듈의 JS·CSS 를 react-dom preloadModule / preinit 로 등록 (§6.4)
12 isBot ? onAllReady 에서 pipe : onShellReady 에서 pipe
13 renderTimeout 후 abort() — 미완료 Suspense 는 클라 렌더로 넘어감
```

- 8 의 로더들은 같은 `AbortController.signal` 을 받는다. 응답 완료 전 `res.on('close')` 시 abort.
- `GET`·`HEAD` 외 요청은 5 와 6 사이에 §5.11 의 검사(405·403)가 끼고, 7 의 맨 안쪽에서 **action → 로더** 순서로 돈다. 미들웨어가 action 도 감싸므로 인증 가드를 우회할 수 없다.
- `HEAD` 요청은 10 까지 수행 후 본문 없이 종료.

### 5.2 스트리밍 데이터 (R2)

로더 반환 객체 안의 Promise 를 그대로 스트리밍한다.

```ts
export const loader = async () => ({ gold: await getGold(), chart: getChart() /* Promise */ });
// 컴포넌트: const chart = use(useLoaderData<typeof loader>().chart)  (Suspense 경계 안)
```

- 직렬화기(§7)가 Promise 에 ID 를 부여하고 자리표시자를 넣는다. 클라는 자리표시자를 pending Promise 로 복원한다.
- resolve/reject 시 `<script>__SSRKR(id, 1|0, 직렬화값)</script>` 를 만든다. reject 값은 `RouteError` 로 바꿔 보낸다(prod 에서 메시지 숨김).
- **삽입 위치:** React 는 출력을 2KB 단위로 잘라 `write` 하므로 write 사이는 태그 중간일 수 있다. 대신 React 가 flush 사이클 끝에 부르는 `destination.flush()` 를 경계로 쓴다(`server/deferred.ts` 의 `DeferredWriter`). flush 중이면 큐에 쌓았다가 `flush()` 때 쓰고, flush 사이면 바로 쓴다.
- 클라 모듈보다 settle 스크립트가 먼저 올 수 있어, 부트스트랩 스크립트가 `window.__SSRKR` 을 큐(`__SSRKQ`)로 먼저 정의하고 `hydrate` 가 큐를 비운다.
- 렌더 스트림이 끝나면 남은 Promise 가 settle 될 때까지 기다린 뒤 스크립트를 쓰고 `end()`. renderTimeout 이 지나면 남은 Promise 는 reject 로 보낸다.
- 데이터 엔드포인트(§5.6)에서는 Promise 를 기다렸다가 settle 된 Promise(`['p', 1|0, 값]`)로 보낸다. 클라 이동 후에도 컴포넌트가 `use()` 를 그대로 쓸 수 있다.
- 로더 데이터 안의 Promise 는 redirect·에러로 버려져도 unhandled rejection 이 나지 않게 `runLoaders` 가 catch 를 붙여 둔다.

### 5.3 SPA 셸 (R6)

매치 경로에 `ssr: false` 가 있으면 로더·라우트 렌더를 건너뛰고 Document 만 렌더한다(`App` 자리에 빈 셸). 클라는 hydrate 후 데이터 엔드포인트를 호출해 첫 화면을 그린다. 셸 응답은 `Cache-Control: no-cache`.

### 5.4 상태·헤더 병합

- **상태:** 에러가 없으면 200. 에러면 §5.5.
- **헤더:** 루트→리프 순서로 각 로더 `headers` 를 덮어쓴다. **같은 헤더는 더 깊은 라우트가 이긴다.** `Set-Cookie` 는 전부 append.
- 아무도 `Cache-Control` 을 설정하지 않으면 `private, no-store` 를 붙인다(개인화 HTML 이 CDN 에 캐시되는 실수를 막는 쪽이 기본).
- 상태가 400 이상이면(로더 에러·렌더 실패 대체 문서·데이터 엔드포인트 에러) 로더가 정한 값과 상관없이 `Cache-Control: no-store`.
- `Content-Type: text/html; charset=utf-8`. 그 외 캐시 헤더는 추가하지 않는다.

### 5.5 에러 처리 (E1, E2)

| 상황 | 처리 | 상태 |
|---|---|---|
| 로더 `httpError(s)` / `notFound()` | 해당 매치부터 위로 가장 가까운 `ErrorBoundary` 렌더. 그 아래 라우트는 렌더 안 함 | s / 404 |
| 로더 일반 Error | 위와 같음 + `onError(phase: 'loader')` | 500 |
| 미들웨어 `redirect()` | 로더 실행 없이 redirect (데이터 엔드포인트는 `type: 'redirect'`) | 3xx |
| 미들웨어 `httpError`·일반 Error | 그 미들웨어의 라우트부터 위로 가장 가까운 `ErrorBoundary`. 그 아래 로더는 실행 안 함(위쪽 로더만 실행해 레이아웃 데이터 확보). 일반 Error 는 `onError(phase: 'middleware')` | s / 500 |
| 여러 로더 실패 | **가장 상위** 실패 매치 기준 | 그 에러의 상태 |
| 위쪽에 `ErrorBoundary` 없음 | 기본 루트 에러 UI (Document + 상태·메시지) | 그대로 |
| 라우트 컴포넌트 렌더 throw | 서버: Suspense 경계 밖이면 `onShellError` → 기본 루트 에러 UI 로 재렌더. 클라: 매 라우트를 감싼 React 에러 경계가 가장 가까운 `ErrorBoundary` 렌더 | 500 |
| 셸 이후 Suspense 내부 throw | React 가 해당 경계를 클라 렌더로 전환. `onError(phase: 'stream')` | 이미 전송됨 |

```ts
export interface RouteError { status: number; message: string; /** dev 에서만 */ stack?: string }
```
prod 에서는 일반 Error 의 `message` 를 상태별 기본 문구로 바꾸고 `stack` 을 보내지 않는다. `httpError(status, message)` 로 명시한 메시지는 유지.

### 5.6 데이터 엔드포인트 (D6)

```
GET /_data/gold/1?tab=chart  →  200 application/json
```

```ts
type DataResponse =
  | { type: 'data'; payload: SsrPayload }          // §7 과 같은 모양
  | { type: 'redirect'; to: string; status: number };
```

- Promise 대기에도 문서와 같은 `renderTimeout` 과 연결 종료(abort)를 적용한다. 시간 안에 안 끝나거나 직렬화할 수 없는 값은 reject 로 보내고 `onError(phase: 'data')` 로 보고한다.
- **매치된 모든 미들웨어·로더를 실행한다.** 자식 데이터만 필요한 이동이어도 루트 미들웨어부터 돈다. 상위 로더 생략(v0.1 의 `X-SSRK-Routes`)은 인증 우회 위험(V2)으로 v1 에서 제외.
- 로더 에러도 `type: 'data'` 의 `payload.error` 로 보낸다(문서 응답과 같은 상태 코드).
- redirect 는 HTTP 200 + `type: 'redirect'` (fetch 가 자동으로 따라가 문서 HTML 을 받는 걸 막기 위함).
- 응답 헤더는 §5.4 규칙 그대로. 매치 없으면 404.
- `GET` 과 action 메서드(POST·PUT·PATCH·DELETE, §5.11)만 허용. 그 외(HEAD 포함) 405.

### 5.7 head 병합 (A1)

```ts
export interface HeadTags {
  title?: string;
  meta?: Array<{ name?: string; property?: string; charSet?: string; content?: string }>;
  link?: Array<{ rel: string; href: string; [k: string]: string | undefined }>;
}
```
- 루트→리프 순서로 각 모듈의 `head({ data, params })` 결과 병합. `title` 은 마지막 값. `meta` 는 `name ?? property ?? charSet` 키로 중복 제거(깊은 쪽이 이김). `link` 는 `rel+href` 중복 제거 후 append.
- 에러 시 에러 경계 라우트 바로 위까지의 head 만 사용.
- 서버·클라 모두 `<Head />` 가 같은 입력(로더 데이터)으로 계산해 렌더하므로 hydrate 시 일치한다. 클라 이동 시 React 가 `<head>` 안 요소를 갱신한다.

### 5.8 Document (A4)

```tsx
export interface DocumentProps { children: React.ReactNode }
// 기본 구현 — 사용자 Document 도 반드시 <Head /> 와 children 을 렌더
export const DefaultDocument = ({ children }: DocumentProps) => (
  <html lang="ko">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <Head />
    </head>
    <body>{children}</body>
  </html>
);
```
- **document 전체를 hydrate** 한다: `hydrateRoot(document, <Root />)`. 서버·클라가 같은 트리(Document 포함)를 렌더하므로 `useId` 가 일치한다(V1).
- 직렬화 데이터·부트스트랩 스크립트·에셋 프리로드는 React 트리 밖(`bootstrapScriptContent`, `bootstrapModules`, `preloadModule`/`preinit`)으로 출력해 hydrate 비교 대상이 아니다.

### 5.9 라우트 미들웨어

```ts
// src/pages/Admin.tsx
export const middleware: Middleware = async ({ request, context }, next) => {
  const user = await getSession(request);           // *.server 모듈 import 가능 (클라에서 제거)
  if (!user) redirect(`/login?next=${request.url.pathname}`);
  context.user = user;                               // 이후 로더가 같은 context 를 받는다
  await next();                                      // 생략 가능 — 끝나면 자동으로 다음
};
```

- 실행: 매치 전체의 미들웨어를 **루트 → 리프** 순서로 onion 실행하고 맨 안쪽에서 로더(병렬)를 돌린다. `next()` 이후 코드는 로더가 끝난 뒤 리프 → 루트로 실행된다. 배열이면 배열 순서대로.
- 문서·데이터 엔드포인트 요청 모두 실행한다. `ssr: false` 셸 문서는 로더처럼 건너뛴다(셸에는 데이터가 없고, 클라가 이어서 부르는 데이터 요청에서 실행된다).
- `next()` 를 두 번 부르면 에러. 미들웨어가 throw 한 에러를 바깥 미들웨어가 삼켜도 **로더가 아직 안 돌았으면 실패로 처리**한다(가드 우회 방지). 로더가 끝난 뒤(next 이후) 에러를 바깥이 삼키면 성공.
- `headers` 는 같은 라우트 로더와 같은 객체 — §5.4 병합 규칙 그대로. redirect·에러 응답에도 병합한다(Set-Cookie 유지).
- **인증은 미들웨어에 둔다.** 로더와 달리 이동마다 매치된 모든 라우트에서 돈다는 계약이 있어, 나중에 상위 로더 생략(재검토 시)이 들어와도 인증이 빠지지 않는다(V2). 지금은 상위 로더 생략을 하지 않는다.
- 내부 구현 `runMiddleware(matches, modules, args, inner)` (`core/middleware.ts`) 는 inner 를 받는 범용 파이프라인이라 다른 요청 종류(예: mutation)에도 재사용한다.
- 클라: strip 이 `middleware` 를 지우고 `__ssrkLoader` 표시를 남긴다 → 로더가 없는 라우트도 이동 시 데이터 요청을 보내 미들웨어가 실행된다.

### 5.10 Server-Timing·관측

- 측정: 미들웨어 합계(로더 시간 제외) `mw`, 로더별 `loader-<routeId>`, 문서는 렌더 시작 → 셸(봇 모드면 전체) `shell`.
- 헤더: `Server-Timing: mw;dur=1.2, loader-root;dur=3.4, loader-gold;dur=10.1, shell;dur=4.0`. 이름은 token 문자 외를 `-` 로(`gold/[id]` → `loader-gold--id-`), dur 은 소수 1자리.
- 스트리밍 문서는 헤더가 셸과 함께 나가므로 **그 시점까지 측정한 값만** 들어간다(Suspense 스트리밍 시간은 없음). 렌더러가 헤더를 쓰기 직전에 부르는 `TreeRenderOptions.onHead` 로 붙인다. redirect·데이터 응답에도 붙는다(`shell` 없음).
- 옵션 `serverTiming` 기본값은 `build.dev` — prod 에서 켜면 라우트 id·로더 지연이 외부에 보인다.
- `onTiming(entries, { url })`: 헤더와 무관하게 요청마다 호출(문서는 셸이 나간 뒤, 데이터는 응답 뒤). 측정값이 없으면(매치 없음 등) 부르지 않는다.

### 5.11 action 요청 흐름

```
1  matches = match(pathname)       없음 → next() 또는 405
2  modules = await loadModules(matches)
3  action 있는 가장 깊은 매치 없음, 또는 action 메서드 아님 → next() 또는 405 (데이터 요청은 항상 405)
4  Origin/Referer 검사 실패 → 403 (action 실행 안 함)
5  context = await getContext(req)
6  미들웨어(루트 → 리프, §5.9) 안쪽에서 actionData = await action(args)
     미들웨어가 redirect·에러를 내면 action 은 실행하지 않는다 (인증 가드 우회 불가)
     redirect → 문서: 303 + Location / 데이터: 200 { type: 'redirect', status: 303 }
     에러     → 위쪽 로더만 실행, 경계 렌더, 그 상태
7  로더 전부 실행 → payload.actionData = actionData
8  문서: Document 렌더(200) / 데이터: 200 { type: 'data', payload }
```

- `ssr: false` 라우트도 action 은 실행한다. redirect 가 아니면 셸을 응답한다(JS 없는 제출의 actionData 는 버려짐).
- 데이터 요청 POST 는 `POST /_data/<원래 경로>?<쿼리>`. 응답 모양은 §5.6 과 같다.

## 6. Vite 플러그인 (`ssr-kit/vite`)

### 6.1 옵션

```ts
export interface SsrKitPluginOptions {
  routes: string;          // routes 파일 경로 (root 기준)
  document?: string;       // Document 컴포넌트 파일 경로
  dataPrefix?: string;     // 기본 '/_data'
  routesDts?: boolean | string; // 타입 안전 링크 d.ts 생성 (§4.4)
}
```

### 6.2 빌드 구성 (B1, B5)

Environment API 로 `client`, `ssr` 두 환경을 정의하고 `builder.buildApp` 에서 client → ssr 순서로 빌드한다.

| 환경 | 엔트리 | 출력 | 비고 |
|---|---|---|---|
| client | `virtual:ssr-kit/client-entry` | `dist/client/` + `.vite/manifest.json` | `build.manifest: true` |
| ssr | `virtual:ssr-kit/server-entry` | `dist/server/entry.js` | client 매니페스트를 읽어 인라인 |

가상 모듈:
```ts
// virtual:ssr-kit/client-entry
import '@vitejs/plugin-react/preamble';   // dev 에서만 내용 있음 (plugin-react 6 제공)
import { hydrate } from 'ssr-kit/client';
import routes from '/src/routes.ts';
import Document from '/src/Document.tsx';
hydrate({ routes, Document });

// virtual:ssr-kit/server-entry
import routes from '/src/routes.ts';
import Document from '/src/Document.tsx';
export const build = { routes, Document, manifest: /* §6.4 */, dataPrefix: '/_data', dev: false };
```

**라우트 모듈 식별:** 플러그인이 `routes` 파일을 `oxc-parser` 로 파싱해 `() => import('리터럴')` 을 찾고, `transform` 에서 `__ssrkModule(() => import('./x'), 'src/pages/x.tsx')` 로 감싼다. 두 번째 인자는 root 기준 경로 = 매니페스트 키. 런타임은 이 키로 에셋을 찾는다. 리터럴이 아닌 `import(변수)` 는 빌드 에러.

### 6.3 서버 코드 제거 (B2)

client 환경 `transform`(일반 순서 — Vite 내장 TS 변환 이후라 타입 참조가 없다)에서 라우트 모듈에 대해:

1. `oxc-parser` 로 파싱해 서버 전용 export(`SERVER_EXPORTS = ['loader', 'action', 'middleware']`)의 `export const` / `export function` / `export { … }` 를 제거한다. 데이터 요청 표시(`__ssrkLoader`)는 `loader`·`middleware` 를 지웠을 때만 남긴다(이동마다 서버에서 로더·미들웨어를 돌려야 하므로). `action` 만 있으면 이동 시 데이터를 요청하지 않는다.
2. export 되지 않은 최상위 선언(함수·클래스·변수, 구조분해·부작용 있는 초기값 포함) 중 **원래는 참조되다가 로더를 지운 뒤 참조가 사라진 것**을 반복 제거한다(고정점까지). 로더 전용 헬퍼·DB 풀·비밀값이 서버 import 를 붙잡아 두는 걸 막기 위함. 처음부터 안 쓰이던 선언(의도된 부작용)은 남긴다.
3. 참조가 사라진 import 바인딩 제거. 바인딩이 모두 사라진 import 문은 통째로 제거(사이드이펙트 import `import 'x'` 는 유지).
4. `magic-string` 으로 소스맵 유지.

안전장치:
- `node_modules` 밖의 `*.server.(ts|tsx|js|jsx)` 이거나 `/server/` 디렉토리 아래 모듈이 client 환경에서 로드되면 **에러**.
- ssr 환경은 변환 없음.

### 6.4 에셋 (A2)

```ts
interface AssetManifest {
  entry: { file: string; css: string[] };
  /** 매니페스트 키(§6.2) → 청크와 재귀 평탄화된 import·css */
  modules: Record<string, { file: string; imports: string[]; css: string[] }>;
}
```
- 서버 렌더 중 매치된 라우트 모듈들의 JS 는 `ReactDOM.preloadModule(href)`, CSS 는 `ReactDOM.preinit(href, { as: 'style', precedence: 'default' })`. React Float 가 `<head>` 에 넣고 hydrate 비교에서 빠진다.
- dev 에서는 가상 엔트리가 의존성 스캔에 잡히지 않아 첫 로드에 재최적화(React 두 벌)가 생긴다. 플러그인이 client 환경 `optimizeDeps.include` 에 react·react-dom·jsx-runtime 을 넣는다.
- 클라엔 매니페스트가 없다(V3). 클라 이동·프리패치는 `route.module()` 호출 — Vite 의 dynamic import preload helper 가 의존 청크·CSS 를 불러온다.
- 모든 URL 앞에 Vite `base`.

### 6.5 dev (B3, E4)

```ts
export function createDevServer(opts: { root: string; configFile?: string }): Promise<{
  middlewares: import('vite').Connect.Server;
  getBuild: () => Promise<ServerBuild>;
  close: () => Promise<void>;
}>;
```
- 내부: `createServer({ root, server: { middlewareMode: true }, appType: 'custom' })`.
- `getBuild` 는 `server.environments.ssr`(`isRunnableDevEnvironment` 확인) 의 `runner.import('virtual:ssr-kit/server-entry')`. 모듈 그래프 무효화는 러너가 처리.
- dev 에서 `bootstrapModules` 는 `['/@vite/client', '/@id/__x00__virtual:ssr-kit/client-entry']`. React Refresh preamble 은 client-entry 의 첫 import(`@vitejs/plugin-react/preamble`)로 해결해 HTML 주입이 필요 없다.
- dev 에셋: 매치된 라우트 모듈의 ssr 모듈 그래프에서 CSS 모듈을 찾아 `preinit(url + '?direct', { as: 'style' })` — 첫 화면 FOUC 방지.
- 에러: Vite 8 모듈 러너가 스택을 소스맵 기준으로 이미 고쳐 주므로 `ssrFixStacktrace` 를 부르지 않는다(중복 호출 시 Vite 가 메시지에 경고를 덧붙인다). 5xx 로더·렌더 에러는 클라 `hydrate`·이동 시 `customElements.get('vite-error-overlay')` 로 Vite 에러 오버레이를 띄운다(dev 에서만, 4xx 는 제외).
- **Fast Refresh (V5):** 라우트 모듈은 `loader`·`middleware`·`head`·`__ssrkLoader` 같은 비컴포넌트 export 때문에 React Refresh 경계가 되지 못한다. 플러그인이 dev client 라우트 모듈 끝에 코드를 붙여 plugin-react 런타임의 `window.__getReactRefreshIgnoredExports` 로 이 export 들을 경계 검사에서 빼고, `import.meta.hot.accept` 에서 `revalidate()` 를 불러 서버 로더 변경도 반영한다. 컴포넌트 상태는 보존된다. `head` 변경은 다음 이동 때 반영된다.

### 6.7 파일 기반 라우팅 (RT5)

`fsRoutes({ dir, outFile? })` 플러그인이 폴더 구조로 routes 파일(`node_modules/.ssr-kit/routes.generated.js`)을 만들고, `ssrKit({ routes: DEFAULT_FS_ROUTES_FILE })` 가 그 파일을 읽는다. 가상 모듈 대신 실제 파일을 써서 ssrKit 의 라우트 탐색을 그대로 재사용한다.

| 파일 | 라우트 |
|---|---|
| `_layout.tsx` | 그 폴더의 레이아웃 (루트면 pathless) |
| `index.tsx` | 인덱스 |
| `[id].tsx` / `[[lang]]` / `[...rest].tsx` | `:id` / `:lang?` / `*` |
| `(group)/` | 세그먼트 없는 그룹 |
| `_` 로 시작, `*.test.*`·`*.spec.*`·`*.stories.*`·`*.server.*` | 무시 |

- 라우트 id 는 `dir` 기준 경로에서 확장자를 뺀 값(`gold/[id]`).
- dev 에서 파일 추가·삭제 시 다시 생성한다. 내용이 같으면 쓰지 않는다.

### 6.8 prerender (B6)

`ssr-kit/prerender` 의 `prerender({ build, paths, outDir, data? })` 또는 CLI `ssr-kit-prerender --entry dist/server/entry.js --out <dir> /a /b`. 경로마다 `handleRequest` 를 봇 모드(Suspense 완료 대기)로 돌려 200 이면 `<outDir>/<path>/index.html` 을 쓴다. 404 는 결과에만 남긴다.

- 클라 이동용 데이터도 `<outDir><dataPrefix>/<path>/index.json` 으로 쓴다(`data: false` 로 끔). redirect 경로는 HTML 은 안 쓰지만 데이터 응답(`type: 'redirect'`)은 써서 클라 이동이 따라갈 수 있다.
- 정적 호스팅에서는 `<dataPrefix>/:path` → `<dataPrefix>/:path/index.json` rewrite 가 필요하다(Netlify `_redirects`, Cloudflare Pages, Vercel `rewrites`).

### 6.6 브라우저 타겟 (B4)

플러그인은 `build.target` 을 건드리지 않는다. 클라 런타임은 ES2020 문법 + `fetch`, `AbortController`, `history.pushState`, `IntersectionObserver`(없으면 viewport 프리패치 비활성)만 쓴다. Navigation API·`structuredClone` 미사용.

#### 6.6.1 구형 WebView·ES 모듈 미지원 브라우저 (`@vitejs/plugin-legacy`)

사용자 Vite 설정에 `@vitejs/plugin-legacy` 가 있으면(플러그인 이름 `vite:legacy-post-process` 로 감지) 클라 빌드가 모던 청크와 함께 SystemJS 레거시 청크·폴리필을 낸다. 플러그인은 그 스크립트를 `index.html` 에만 넣고 React 는 `nomodule` 스크립트를 낼 수 없으므로, ssr-kit 이 같은 태그를 만든다.

- 서버 엔트리 빌드 때 client 매니페스트에서 모던 엔트리·레거시 엔트리(`<엔트리 키>-legacy`)·레거시 폴리필(`vite/legacy-polyfills-legacy`)·모던 폴리필(`vite/legacy-polyfills`)을 찾는다. 가상 모듈 키는 root 가 cwd 와 다르면 앞에 상대 경로가 붙어 끝부분으로 찾는다. 레거시 청크도 `isEntry` 라 부트스트랩·프리로드는 반드시 모던 엔트리로 고른다.
- `ServerBuild.tailHtml?: (nonce?: string) => string`. 빌드 때 태그를 nonce 자리로 나눈 조각으로 저장하고(`createTailHtml(parts)`), 요청마다 nonce 를 이스케이프해 모든 `<script>` 에 넣는다. 태그(base 접두사 포함)는 plugin-legacy 8.2.4 와 같다: Safari 10.1 nomodule 수정 → `<script nomodule crossorigin id="vite-legacy-polyfill" src>` → `<script nomodule crossorigin id="vite-legacy-entry" data-src>System.import(…)` → 모던 감지 `type="module"` 인라인 → 동적 import 폴백 `type="module"` 인라인. 인라인 코드는 플러그인이 export 하지 않아(`cspHashes` 만 export) 옮겨 왔고, 단위 테스트가 설치된 버전의 `cspHashes` 와 sha256 을 대조한다.
- 감지·폴백 스크립트는 plugin-legacy 가 `<head>` 에 넣지만 인라인 모듈(defer)이라 위치와 관계없이 파싱이 끝난 뒤 순서대로 돈다. 모던 브라우저는 `nomodule` 을 건너뛰고 감지 스크립트가 `__vite_is_modern_browser` 를 켜 폴백도 아무것도 안 한다. 모듈은 되지만 `import.meta.resolve`·동적 import 가 없는 브라우저는 모던 엔트리 맨 앞의 legacy guard import 가 throw 해 모던 번들이 실행되지 않고 폴백이 레거시 번들을 띄운다. 그래서 hydrate 는 한 번이다.
- 붙이는 위치: Node(`DeferredWriter._final`)·edge(`appendDeferred` flush) 모두 React 출력이 끝난 직후, 아직 settle 되지 않은 Promise 의 스크립트보다 먼저 한 번. React 가 끝난 시점이 `</html>` 뒤 태그 경계가 보장되는 유일한 때이고, 레거시 브라우저가 느린 Promise 를 기다리지 않고 바로 hydrate 를 시작하게 하려는 것(모던은 부트스트랩 모듈이 셸에 있어 원래 기다리지 않는다). 늦게 오는 settle 스크립트는 인라인 부트스트랩의 `__SSRKQ` 큐가 받는다. `render()`(RT6)·봇 모드·prerender 에도 붙고, HEAD 응답에는 없다.
- `modernPolyfills` 청크는 `bootstrapModules` 의 엔트리 앞에 둔다. React 는 부트스트랩 모듈을 `async` 로 내므로 폴리필이 엔트리보다 먼저 실행된다는 보장은 없다(한계).
- `renderModernChunks: false` 는 지원하지 않는다(빌드 에러). dev 는 plugin-legacy 가 빌드 전용이라 영향이 없다.
- plugin-legacy 는 환경별 설정마다 설정 파일을 다시 읽어 새 인스턴스를 만들어야 동작한다. `createBuilder({ configFile: false, plugins: [legacy()] })` 처럼 인라인으로 넘기면 인스턴스가 client·ssr 설정에 공유돼 레거시 폴리필이 안 만들어진다(plugin-legacy 쪽 동작). 이때 ssr-kit 은 원인을 담은 빌드 에러를 낸다.
- CSP: 모던 엔트리의 legacy guard 가 `data:` URL 을 import 하므로 `script-src` 에 `data:` 가 필요할 수 있다(plugin-legacy 와 같은 조건).

## 7. 직렬화 (D3)

자체 구현, 의존성 0.

- 지원: JSON 기본형, `undefined`, `Date`, `Map`, `Set`, `BigInt`, `RegExp`, `URL`, `NaN`/`±Infinity`/`-0`, 공유·순환 참조, `Promise`(§5.2, P1).
- 미지원(throw, 경로 표시): 함수, `Symbol`, 위 목록 외 클래스 인스턴스.
- 형식: 값 테이블 평탄화 + 인덱스 참조. 복원은 `JSON.parse` 후 재구성 — `eval` 없음.
- 문서 출력: `bootstrapScriptContent` 로 `window.__SSRK=…` 를 넣는다. `<` → `<`, ` `, ` ` 이스케이프.
- 실어 보내는 값 `SsrPayload`: `{ routes: string[], data: { [routeId]: unknown }, error?: { routeId, error: RouteError }, status, actionData? }`.
- dev 에서 직렬화 결과가 100KB 를 넘으면 콘솔 경고.

## 8. 클라이언트 런타임 (`ssr-kit/client`)

### 8.1 hydrate

```ts
export function hydrate(opts: {
  routes: RouteDef[];
  Document?: React.ComponentType<DocumentProps>;
  /** 플러그인이 가상 엔트리에서 넘김 */
  dataPrefix?: string;
  dev?: boolean;
  onError?: (error: unknown) => void;
}): Promise<void>;
export function readSsrData<T>(): T; // RT6 용
```
1. `window.__SSRK` 에서 매치 라우트 ID, 로더 데이터, 에러 상태를 읽는다.
2. 현재 URL 을 매칭해 같은 라우트들을 만들고, 라우트 모듈을 `Promise.all` 로 import.
3. `hydrateRoot(document, <Root />, { onRecoverableError, onCaughtError, onUncaughtError })` — 세 콜백은 `onError` 로 연결. 불일치 diff 는 React 19 dev 경고에 맡긴다(V11).

### 8.2 네비게이션

```
navigate(to)
1  진행 중 네비게이션 abort
2  matches = match(to)   없음 → location.assign(to)
3  state = 'loading'
4  병렬: 라우트 모듈 import + (로더 있는 매치가 있으면) GET {dataPrefix}{to}
   모듈 import 실패(배포로 청크 삭제 등, V10) → location.assign(to)
5  응답 type
     redirect → 같은 origin 이면 navigate(to, { replace: true }), 아니면 location.assign
     data     → 데이터·에러 상태 교체
6  history.pushState / replaceState  (popstate 로 온 경우 생략)
7  startTransition(() => setState(...)) — 이전 화면을 유지하다 교체
8  스크롤: 해시 있으면 해당 요소, 아니면 top. popstate 면 저장 위치 복원. state='idle'
```
- `history.scrollRestoration = 'manual'`, 위치는 `sessionStorage` 에 history key 별로 저장. `pagehide` 때도 저장하고 hydrate 때 복원해 새로고침·문서 간 뒤로가기에서도 위치가 남는다.
- 데이터 응답의 redirect 는 HTTP 200 이라 브라우저 한도가 없으므로 10번까지만 따라가고, 넘으면 `location.assign` 으로 브라우저에 맡긴다.
- `revalidate()` 는 프리패치 데이터를 쓰지 않고, 진행 중인 이동이 있으면 아무것도 하지 않는다(그 이동이 최신 데이터를 가져온다).
- 데이터 응답으로 복원한 settle 된 Promise 에는 React thenable 상태(`status`·`value`)를 달아 `use()` 가 다시 suspend 하지 않게 한다(이동 시 Suspense fallback 깜빡임 방지).
- 데이터 요청 네트워크 에러 → `location.assign(to)`.
- 데이터 캐시 없음(G2). `intent` 프리패치 결과는 직후 1회 네비게이션에 한해 재사용(10초 이내).
- 프리패치 항목은 모듈 로드를 기다리지 않고 즉시 등록한다. 클릭은 mousedown 의 focus 프리패치 직후에 오므로, 늦게 등록하면 같은 데이터를 두 번 요청한다.
- 같은 문서의 해시 링크(경로·쿼리 같고 해시만 다름)는 이동 때 데이터를 받지 않으므로 프리패치도 하지 않는다.

### 8.3 프리패치 (RT4)

| 모드 | 트리거 | 가져오는 것 |
|---|---|---|
| `intent` (기본) | `mouseenter` 후 100ms, `focus`, `touchstart` | `route.module()` + 데이터 |
| `viewport` | `IntersectionObserver` 진입 | `route.module()` 만 |
| `none` | — | — |

### 8.4 Link

- 렌더 결과는 일반 `<a href>`. 하이드레이션 전에도 동작.
- 가로채지 않는 경우: 수정 키(ctrl/meta/shift/alt), 좌클릭 외 버튼, `target` 지정(`_self` 제외), `download`, 다른 origin, `reloadDocument` prop.

### 8.5 Form·submit

```
submit(target, { method = 'post', action = 현재 경로+쿼리, replace })
1  method 'get' → 값을 쿼리로 바꿔 navigate (§8.2)
2  다른 origin → reject
3  진행 중 네비게이션 abort, navigation = { state: 'submitting', location, formMethod, formData }
4  병렬: 라우트 모듈 import + fetch(METHOD {dataPrefix}{action}, body)
     파일이 없으면 URLSearchParams(JS 없는 폼과 같은 urlencoded), 있으면 FormData(multipart)
5  redirect → §8.2 redirect 처리(GET 데이터 요청, 10번 한도)
   data     → actionData·로더 데이터로 교체 (추가 revalidate 요청 없음)
6  기록: action 이 현재 주소면 기록·스크롤 그대로(revalidate 와 같음), 아니면 push(replace 면 replace)
```

- 네트워크 실패 시 `navigation` 을 idle 로 돌리고 `submit()` Promise 가 reject 한다. POST 는 문서 이동으로 재시도할 수 없어서다. `<Form>` 은 콘솔 에러로 남긴다.
- 제출 중 `navigate` 가 오면 submit 요청을 abort 하고 늦게 온 응답은 버린다(서버에서 action 은 이미 실행됐을 수 있다).
- `<Form>` 은 `method` 가 get 이 아니면 `method="post"` 로 렌더해 JS 없이도 POST 로 제출된다(put·patch·delete 는 JS 없이는 POST). 가로채지 않는 경우: `reloadDocument`, `onSubmit` 에서 `preventDefault`, `target`/`formtarget` 이 `_self` 아님, 다른 origin `action`/`formaction`.
- 누른 버튼의 `name`/`value` 를 FormData 에 붙인다(`new FormData(form, submitter)` 는 구형 WebView 에 없어 직접 append). `formaction`·`formmethod` 도 반영.

## 9. 어댑터

| 어댑터 | 시그니처 | 단계 |
|---|---|---|
| `ssr-kit/node` | `(req, res, next?) => Promise<void>` — Express·Connect·Polka | P0 |
| `ssr-kit/fastify` | `fastify.register(ssrKit, opts)` — `reply.hijack()` 후 `reply.raw` | 구현 |
| `ssr-kit/hono` | `app.use('*', ssrKit(opts))` 미들웨어 — 매치 없으면 `next()` | 구현 |
| `ssr-kit/web` | `createWebHandler(opts)(request) => Promise<Response \| null>` — Node 스트림 렌더러 | 구현 |
| `ssr-kit/edge` | `createEdgeHandler(opts)(request) => Promise<Response \| null>` — `renderToReadableStream`, `node:*` 없음 | 구현 |

- `server/request` 는 `RenderSink` 인터페이스(`writeHead`·`end`·`signal`·`renderTree`)에만 의존하고 렌더러는 sink 가 가진다. Node 렌더러(`server/stream.tsx`: `renderToPipeableStream` + flush 경계 데이터 삽입)와 Web 렌더러(`edge/index.tsx`)가 있다.
- `ssr-kit/web` 은 Node 렌더러를 `Readable.toWeb` 으로 감싸 Node·Bun·Deno 에서 쓴다. Promise 데이터를 React 출력 사이사이에 끼울 수 있다.
- `ssr-kit/edge` 는 Workers·Vercel Edge 용. React web 스트림은 flush 경계를 알 수 없어서 settle 스크립트를 **React 출력이 끝난 뒤에** 붙인다. HTML 의 Suspense 경계는 그대로 점진 스트리밍되지만, Promise 데이터를 쓰는 경계의 hydrate 는 응답 끝까지 기다린다.
- `ssr-kit/hono` 는 어디서나 돌도록 edge 렌더러를 쓴다.
- **압축과 스트리밍:** workerd 등 런타임이 HTML 을 gzip 하면 압축기가 응답 끝까지 모아 셸이 먼저 오지 않는다(로컬 `wrangler dev` 에서 4.4KB 셸이 2초 뒤 한꺼번에 도착하는 걸 확인). edge 어댑터는 스트리밍 문서(봇 모드가 아니고 사용자가 `Content-Encoding` 을 정하지 않은 경우)에 `Content-Encoding: identity` 를 붙인다. Node 어댑터는 `compression()` 같은 압축 미들웨어가 붙인 `res.flush()` 를 React flush 마다 호출한다.
- edge 모듈 그래프에 `node:*` import 가 없는지 테스트(`test/edge.test.tsx`)로 확인한다.
- 어댑터 공통 옵션은 `AdapterOptions<Req>` (콜백은 각 프레임워크의 원본 요청/Context 를 받는다).

`server/` 는 `SsrRequest` 와 `RenderSink` 만 안다. 어댑터는 원본 요청 → `SsrRequest` 변환과 sink 구현만 담당한다.

```ts
export interface RenderSink {
  /** 상태·헤더 확정 후 한 번 호출 */
  writeHead(status: number, headers: Headers): void;
  /** 본문 쓰기 대상 (Node: Writable) */
  stream: import('node:stream').Writable;
  /** 연결 종료 감지 */
  signal: AbortSignal;
}
```

## 10. 보안

| 항목 | 대응 |
|---|---|
| 직렬화 XSS | §7 이스케이프, 직렬화 결과를 `innerHTML` 로 쓰지 않음 |
| 로더 코드 유출 | §6.3 제거 + `*.server`·`/server/` 차단 |
| 상위 로더 인증 우회 | 데이터 요청도 매치 미들웨어·로더 전부 실행 (§5.6). 인증은 라우트 `middleware` 에 (§5.9) |
| 미들웨어 가드 우회 | 바깥 미들웨어가 가드 에러를 삼켜도 로더 미실행이면 실패 처리 (§5.9) |
| 미들웨어 코드 유출 | `middleware` 도 §6.3 으로 클라 번들에서 제거 |
| 내부 정보 노출 (Server-Timing) | prod 기본 off. 켜면 라우트 id·로더 지연 노출 (§5.10) |
| CSRF (action) | Origin/Referer host 검사, 실패 시 403 (§3.8). 쿠키 `SameSite` 는 사용자 몫 |
| action 코드 유출 | §6.3 이 `loader` 와 같이 제거 |
| 에러 메시지 노출 | prod 에서 일반 Error 메시지·스택 미전송 (§5.5) |
| 개인화 HTML 캐시 | 기본 `Cache-Control: private, no-store` (§5.4) |
| CSP | `getNonce` → `nonce` 옵션 (부트스트랩·데이터·plugin-legacy 스크립트) |
| 오픈 리다이렉트 | `redirect()` 는 값 검증 안 함 — 문서화. 클라는 다른 origin 이면 `location.assign` |
| 경로 조작 | `decodeURIComponent` 실패 시 400 |

## 11. 성능 예산

| 지표 | 측정 방법 | 기준 |
|---|---|---|
| 서버 런타임 크기 | `dist/server.js`+`dist/node.js`+공용 청크 min | < 30KB |
| 클라 런타임 크기 | 예제 앱 client 번들 중 ssr-kit 청크 min+gz | < 8KB |
| SSR 오버헤드 | autocannon, 같은 컴포넌트를 순수 `renderToPipeableStream` 서버와 비교, p50 TTFB | +5ms 이내 |
| dev cold start | 100 라우트 픽스처, 서버 시작 → 첫 응답 | < 1.5s |

## 12. 테스트 전략

| 레벨 | 대상 | 도구 |
|---|---|---|
| 단위 | 매칭·우선순위, 직렬화 왕복, head·헤더 병합, 에러 경계 선택 | Vitest |
| 변환 | §6.3 loader 제거 — 입출력, 헬퍼·import 정리 | Vitest |
| 통합 | 핸들러에 실제 `node:http` 서버 → 상태·헤더·HTML·데이터 응답 | Vitest |
| E2E | 예제 앱 prod 빌드: 첫 렌더·hydrate·Link 이동·redirect·404·에러 경계·뒤로가기 | Playwright (Chromium) |
| 호환 | 구형 Android WebView 실기기 수동 확인 | 체크리스트 |

커버리지 목표: `core/`·`server/` 90% 이상.

## 13. M1 작업 분해

| # | 작업 | 산출물 | 관련 ID |
|---|---|---|---|
| 1 | 모노레포·tsup·Vitest·ESLint·CI | 루트·`packages/core` 골격 | — |
| 2 | 라우트 매칭 + 타입 | `core/match.ts` | RT1, RT2 |
| 3 | 직렬화기 | `core/serialize.ts` | D3 |
| 4 | 로더 실행·redirect/에러·헤더 병합 | `core/loaders.ts` | D1, D2, D4, E1 |
| 5 | head 병합 + Document·Head | `core/head.ts`, `react/` | A1, A4 |
| 6 | 서버 렌더러 + Node 핸들러 | `server/`, `node/` | R1, R4, E2, E3, AD1 |
| 7 | 데이터 엔드포인트 | `server/` | D6 |
| 8 | Vite 플러그인: 환경 빌드·가상 엔트리·매니페스트 | `vite/plugin.ts` | B1, B5, A2 |
| 9 | Vite 플러그인: loader 제거 변환 | `vite/strip.ts` | B2 |
| 10 | dev 서버 | `vite/dev.ts` | B3 |
| 11 | 클라: hydrate·Router·Link·네비게이션·훅 | `client/`, `react/` | RT3, RT4 |
| 12 | `packages/example` + Playwright E2E | 예제·테스트 | — |

## 14. 아직 남은 결정 (M1 중 확정)

1. ~~기본 `isBot` 정규식 범위~~ → 크롤러 토큰만(`xxxbot/`, `Yeti`, `Daumoa`, `kakaotalk-scrap` 등). `naver`·`daum` 은 인앱 브라우저 실사용자 UA 에도 있어 쓰지 않는다.
2. 루트 404 커스텀 — `path: '*'` 라우트로 충분한지.
3. ~~`useNavigation` mutation 확장~~ → `action`·`<Form>`·`submitting` 상태로 구현 (§3.8, §5.11, §8.5).
