# ssr-kit 기술 스펙

- 작성: 안승찬 · 2026-11-11
- 상태: v0.5 (재검증·코드 리뷰 반영, 2026-11-11)
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
| V2 | `X-SSRK-Routes` 로 상위 로더 생략 → 클라가 헤더 조작 시 상위 로더의 인증 검사 우회 | **v1 에서 로더 생략 제거**. 인증은 `getContext`·사용자 미들웨어에서 | §5.6 |
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
| `useNavigate()` | `navigate(to, { replace?, state? })` |
| `useNavigation()` | `{ state: 'idle' \| 'loading', location? }` |
| `useRevalidate()` | 현재 로더 재실행 |
| `useRequestContext()` | 서버: `AppContext`, 클라: `null` |
| `<Link to prefetch="intent" \| "viewport" \| "none">` | 기본 `"intent"` |
| `<Outlet />` | 자식 라우트 렌더 위치 |
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
}

export type ErrorPhase = 'loader' | 'shell' | 'stream' | 'data';

export function createSsrHandler(opts: NodeHandlerOptions):
  (req: IncomingMessage, res: ServerResponse, next?: (err?: unknown) => void) => Promise<void>;
export function getNodeRequest(request: SsrRequest): IncomingMessage;
```

- 매칭 라우트가 없으면 `next` 가 있으면 `next()`, 없으면 루트 404 렌더.
- `GET`·`HEAD` 외 메서드는 `next()` (없으면 405). 문서·데이터 요청은 읽기 전용.
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

## 5. 서버 요청 처리

### 5.1 문서 요청 흐름

```
1  request = toSsrRequest(req)
2  pathname 이 dataPrefix 로 시작 → §5.6
3  matches = match(pathname)          없음 → next() 또는 404
4  ssr:false 가 경로에 있으면 → §5.3
5  modules = await Promise.all(matches.map(m => m.route.module()))
6  context = await getContext(req)
7  results = await Promise.allSettled(로더 있는 매치마다 loader(args))   ← D2 병렬
8  redirect 가 있으면 가장 상위 매치의 redirect 로 응답, 종료
9  에러 → §5.5 로 errorIndex·status 결정
10 status/headers 확정 (§5.4)
11 renderToPipeableStream(<Document><App/></Document>, {
     bootstrapModules: [clientEntry], bootstrapScriptContent: 직렬화 데이터(§7), nonce,
     onShellReady, onAllReady, onShellError, onError })
   렌더 중 매치 모듈의 JS·CSS 를 react-dom preloadModule / preinit 로 등록 (§6.4)
12 isBot ? onAllReady 에서 pipe : onShellReady 에서 pipe
13 renderTimeout 후 abort() — 미완료 Suspense 는 클라 렌더로 넘어감
```

- 7 의 로더들은 같은 `AbortController.signal` 을 받는다. 응답 완료 전 `res.on('close')` 시 abort.
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
- **매치된 모든 로더를 실행한다.** 상위 로더 생략(v0.1 의 `X-SSRK-Routes`)은 인증 우회 위험(V2)으로 v1 에서 제외.
- 로더 에러도 `type: 'data'` 의 `payload.error` 로 보낸다(문서 응답과 같은 상태 코드).
- redirect 는 HTTP 200 + `type: 'redirect'` (fetch 가 자동으로 따라가 문서 HTML 을 받는 걸 막기 위함).
- 응답 헤더는 §5.4 규칙 그대로. 매치 없으면 404.
- `GET` 만 허용.

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

## 6. Vite 플러그인 (`ssr-kit/vite`)

### 6.1 옵션

```ts
export interface SsrKitPluginOptions {
  routes: string;          // routes 파일 경로 (root 기준)
  document?: string;       // Document 컴포넌트 파일 경로
  dataPrefix?: string;     // 기본 '/_data'
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

1. `oxc-parser` 로 파싱해 `export const loader` / `export function loader` / `export { loader }` 를 제거한다.
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
- **Fast Refresh (V5):** 라우트 모듈은 `loader`·`head`·`__ssrkLoader` 같은 비컴포넌트 export 때문에 React Refresh 경계가 되지 못한다. 플러그인이 dev client 라우트 모듈 끝에 코드를 붙여 plugin-react 런타임의 `window.__getReactRefreshIgnoredExports` 로 이 export 들을 경계 검사에서 빼고, `import.meta.hot.accept` 에서 `revalidate()` 를 불러 서버 로더 변경도 반영한다. 컴포넌트 상태는 보존된다. `head` 변경은 다음 이동 때 반영된다.

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

## 7. 직렬화 (D3)

자체 구현, 의존성 0.

- 지원: JSON 기본형, `undefined`, `Date`, `Map`, `Set`, `BigInt`, `RegExp`, `URL`, `NaN`/`±Infinity`/`-0`, 공유·순환 참조, `Promise`(§5.2, P1).
- 미지원(throw, 경로 표시): 함수, `Symbol`, 위 목록 외 클래스 인스턴스.
- 형식: 값 테이블 평탄화 + 인덱스 참조. 복원은 `JSON.parse` 후 재구성 — `eval` 없음.
- 문서 출력: `bootstrapScriptContent` 로 `window.__SSRK=…` 를 넣는다. `<` → `<`, ` `, ` ` 이스케이프.
- 실어 보내는 값 `SsrPayload`: `{ routes: string[], data: { [routeId]: unknown }, error?: { routeId, error: RouteError }, status }`.
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
| 상위 로더 인증 우회 | 데이터 요청도 매치 로더 전부 실행 (§5.6) |
| 에러 메시지 노출 | prod 에서 일반 Error 메시지·스택 미전송 (§5.5) |
| 개인화 HTML 캐시 | 기본 `Cache-Control: private, no-store` (§5.4) |
| CSP | `getNonce` → `nonce` 옵션 (부트스트랩·데이터 스크립트) |
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
3. `useNavigation` mutation 확장 — v1 비목표라 보류.
