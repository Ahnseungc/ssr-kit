# ssr-kit 요구사항 검증표

- 작성: 2026-11-11 · 기준 커밋: `b7d8a43` 이후 재검증 + 독립 코드 리뷰(서브에이전트) 반영
- 근거: [PRD](../../prd/ssr-kit-prd.md) §7·§8, [스펙](./spec.md)
- 표기: **단위** = `packages/core/test` (Vitest) · **E2E** = `packages/example/e2e` (Playwright, prod 빌드) · **수동** = dev 서버를 브라우저로 직접 확인

## 1. 기능 요구사항

| ID | 요구사항 | 상태 | 검증 |
|---|---|---|---|
| R1 | 스트리밍 SSR, `onShellReady` 에 헤더 flush | 구현 | 단위 `stream`·`node-handler` (셸 먼저), E2E |
| R2 | Suspense 단위 점진 스트리밍, 로더 Promise 를 `use()` | 구현 | 단위 `stream`·`edge`·`client-deferred`, E2E `/stream` (문서·클라 이동) |
| R3 | 봇 UA 는 `onAllReady` 까지 대기 | 구현 | 단위 `node-handler` (Googlebot UA → Suspense 채운 HTML) |
| R4 | 렌더 타임아웃, 초과 시 클라 렌더 폴백 | 구현 | 단위 `node-handler` (끝나지 않는 Promise → 200 + 폴백 + reject 스크립트) |
| R5 | 하이드레이션 불일치 표시 | React 19 위임 | 스펙 V11 결정. E2E 에서 콘솔 에러 0 확인 |
| R6 | `ssr: false` SPA 셸 | 구현 | E2E `/shell` |
| RT1 | 코드 라우트·중첩 레이아웃 | 구현 | 단위 `match` |
| RT2 | 동적·옵셔널·와일드카드, 타입 추론 | 구현 | 단위 `match` (`expectTypeOf`) |
| RT3 | 라우트 단위 코드 스플리팅 | 구현 | 예제 빌드 산출물(라우트별 청크), E2E viewport 프리패치 |
| RT4 | `<Link>`·`useNavigate`·프리패치 | 구현 | E2E (이동·intent·viewport·해시·수정 키·뒤로가기 스크롤) |
| RT5 | 파일 기반 라우팅 | 구현 | 단위 `fs-routes`, `vite-build` (실제 Vite 빌드) |
| RT6 | 저수준 `render()` | 구현 | 단위 `render` |
| RT7 | 타입 안전 링크 (`Href`, `href()`, routes d.ts 생성) | 구현 | 단위 `href`·`typed-routes`, 예제 typecheck (`typed-links.test-d.ts` 의 오타 경로 컴파일 에러) |
| D1 | 서버 전용 `loader`, 클라 번들에서 제거 | 구현 | 단위 `strip`·`vite-build`, E2E (클라 번들에 서버 비밀 문자열 없음) |
| D2 | 중첩 로더 병렬 실행 | 구현 | 단위 `loaders` |
| D3 | 직렬화 (Date·Map·Set·BigInt, XSS 이스케이프) | 구현 | 단위 `serialize` |
| D4 | `redirect()`·`notFound()`·상태·헤더 | 구현 | 단위 `loaders`·`web`·`edge`, E2E |
| D5 | TanStack Query 레시피 | 구현 | 예제 `/query`, E2E (SSR·클라 이동 모두 API 재요청 0) |
| D6 | 클라 이동용 데이터 엔드포인트 | 구현 | 단위 `stream`·`web`·`edge`, E2E |
| D7 | 데이터 변경 `action`·`<Form>`·`useSubmit`·`useActionData`·CSRF (스펙 §3.8) | 구현 | 단위 `actions`(실제 http 서버: urlencoded·multipart·JSON·303·경계·405·next·403)·`client-actions`·`web`·`edge`·`fastify`·`strip`, E2E `actions.spec` (JS 제출·검증·403·JS 비활성) |
| A1 | `head()` 병합 | 구현 | 단위 `loaders`(mergeHead), E2E (이동 시 title 변경) |
| A2 | 매니페스트 기반 modulepreload·CSS | 구현 | 단위 `build`·`render`, E2E (SSR HTML 에 preload·stylesheet) |
| A3 | CSP nonce | 구현 | 단위 `render` (모든 script 에 nonce), `stream` (settle 스크립트) |
| A4 | Document 교체 | 구현 | 예제 `Document.tsx`, E2E |
| E1 | 라우트 `ErrorBoundary` | 구현 | 단위 `loaders`, E2E (문서·클라 이동) |
| E2 | 셸 전 에러 500 + 루트 에러 UI | 구현 | 단위 `node-handler`·`edge`·`render` |
| E3 | `onError` 훅 | 구현 | 단위 `node-handler`·`loaders` |
| E4 | dev 에러 오버레이 | 구현 | 수동 (dev `/boom` → Vite 오버레이, 소스 위치 `Boom.tsx:2:9`, 404 는 미표시) |
| B1 | Vite 환경 빌드 | 구현 | 단위 `vite-build`, 예제 빌드 |
| B2 | 서버 코드 제거·`*.server` 차단 | 구현 | 단위 `strip`, 수동 (dev 에서 `data.server.ts` 직접 요청 시 에러) |
| B3 | dev HMR | 구현 | 수동 (라우트 모듈 수정 → 상태 유지 Fast Refresh) |
| B4 | 사용자 `build.target` 존중 | 구현 | 단위 `vite-build` (es2017 → `?.`·`??` 없음) |
| B5 | `dist/client`·`dist/server/entry.js` | 구현 | 예제 빌드 |
| B6 | prerender | 구현 | 단위 `prerender` (HTML·데이터 JSON), E2E (CLI 실행) |
| AD1 | Node·Express 핸들러 | 구현 | 단위 `node-handler` (실제 http 서버), E2E |
| AD2 | Fastify·Hono | 구현 | 단위 `fastify`·`web` |
| AD3 | Web `Request → Response` | 구현 | 단위 `web`·`edge` (edge 모듈 그래프 `node:*` 0) |
| MW | 라우트 `middleware` (onion·가드·context) | 구현 | 단위 `middleware`·`middleware-handler`·`strip`, E2E `/admin` (문서 302·클라 이동·쿠키 통과·번들 제거) |
| OB | Server-Timing·`onTiming` | 구현 | 단위 `middleware-handler` (Web·Edge·Node HEAD, 기본값 dev, 이름 정규화), E2E (prod 기본 미전송) |

## 2. 비기능 요구사항

| 항목 | 목표 | 측정 | 결과 |
|---|---|---|---|
| 클라 런타임 크기 | < 8KB (min+gzip) | `pnpm size` (CI) | 5.71KB |
| 서버 런타임 크기 | < 30KB (min) | `pnpm size` (CI) | 23.99KB |
| 커버리지 | core·server 라인 90% | `pnpm test:coverage` (CI 임계값) | 통과. 클라 라우터·컴포넌트는 E2E 로 검증 |
| 호환 | Node 22+, React 19, Vite 8 | CI(Node 22), 로컬(Node 26) | 통과 |
| 보안 | 직렬화 XSS·로더 유출 0 | 단위 `serialize`·`strip`, E2E 번들 검사 | 통과 |
| SSR 오버헤드 | 순수 렌더 대비 TTFB +5ms | 미측정 | 릴리스 전 벤치 필요 |
| dev cold start | 100 라우트 < 1.5s | 미측정 | 릴리스 전 벤치 필요 |
| 빌드 시간 비교 (PRD §11) | Next 대비 50%↓ | 미측정 | M2 골디 이식 실험에서 측정 |

## 3. 재검증에서 찾아 고친 문제

| # | 문제 | 영향 | 수정 |
|---|---|---|---|
| 1 | Promise 데이터가 React 셸보다 먼저 settle 되면(봇 모드·이미 resolve 된 Promise) settle 스크립트가 문서 앞에 써짐 | HTTP: 헤더 전 본문 → `ERR_HTTP_HEADERS_SENT` 로 **응답이 멈춤**. 메모리: `<!DOCTYPE>` 앞 스크립트 → quirks 모드 | `DeferredWriter` 가 React 첫 flush 전에는 큐에 쌓음. 회귀 테스트 `node-handler`·`stream` |
| 2 | 플러그인 `config` 훅이 사용자의 `outDir` 를 덮어씀 | 사용자 지정 출력 경로 무시 | 사용자 값이 있으면 유지. 회귀 테스트 `vite-build` |
| 3 | tsup 이 `node:stream` → `stream` 으로 접두사 제거 | Deno 등 `node:` 가 필요한 런타임에서 import 실패 | `removeNodeProtocol: false` |
| 4 | 다른 로더를 기다리는 동안 먼저 reject 된 데이터 Promise 에 핸들러가 없음 (Map·Set 안 Promise 도) | `unhandledRejection` 으로 **Node 프로세스 크래시** | 로더별로 즉시 catch, Map·Set·null-proto 순회. 단위 `loaders` |
| 5 | 스트리밍 값이 직렬화 불가(클래스 인스턴스 등)면 settle 실패가 핸들러 없이 reject | 프로세스 크래시·응답 끊김·보고 없음 | reject 스크립트로 바꿔 보내고 `onError('stream')`. 단위 `server-regressions` |
| 6 | 매칭 점수 합산: `*` 가 인덱스 `/` 를, `/:lang?/docs` 가 `/docs` 를 이김 | 잘못된 페이지 렌더 | 세그먼트별 사전식 비교. 단위 `match` |
| 7 | 데이터 응답으로 복원한 Promise 를 `use()` 가 한 번 suspend | 클라 이동 시 Suspense fallback 깜빡임 | thenable 상태 부착. 단위 `serialize` |
| 8 | 서로 redirect 하는 로더 | 클라 이동이 무한 fetch | 10회 제한 후 문서 이동. 단위 `client-router` |
| 9 | 데이터 엔드포인트에 타임아웃·abort 없음 | 끝나지 않는 Promise 면 응답이 영원히 안 옴 | `renderTimeout`·signal 적용, `onError('data')`. 단위 `server-regressions` |
| 10 | strip 이 로더 전용 비함수 값(`new Pool(...)`, 클래스, 구조분해)을 남김 | DB 접속 정보·서버 import 가 클라 번들에 | 후보 확대 + "로더 제거로 참조가 사라진 것만" 규칙. 단위 `strip` |
| 11 | Windows 에서 `path.resolve`(\\) 와 Vite id(/) 비교 실패 | 라우트 CSS·preload 누락, routes 변경 감지 실패 | `normalizePath` 로 통일 |
| 12 | 봇 UA 정규식의 `naver`·`daum`·`bot` | 네이버·다음 앱, CUBOT 폰 사용자가 스트리밍 없이 대기 | 크롤러 토큰만. 단위 `bot-ua` |
| 13 | `revalidate()` 가 프리패치 데이터 재사용·진행 중 이동 중단 | 변경 전 데이터 표시, 사용자 클릭 취소 | 프리패치 미사용, 이동 중이면 무시. 단위 `client-router` |
| 14 | 에러 응답이 로더의 `public` 캐시 헤더를 물려받음 | 500·404 문서가 CDN 에 캐시 | 400 이상은 `no-store`. 단위 `server-regressions` |
| 15 | 새로고침·문서 간 뒤로가기에서 스크롤 위치 소실 | — | `pagehide` 저장 + hydrate 복원. E2E |
| 16 | 이미 끊긴 연결의 signal 에 리스너만 담 | 렌더가 `renderTimeout` 까지 헛돎 | `aborted` 먼저 확인 |
| 17 | 직렬화가 자기 속성 `__proto__` 키를 잃음 | 데이터 손실 | `defineProperty` 로 대입. 단위 `serialize` |
| 18 | 스펙 §7 dev 100KB 경고 미구현 | — | 구현 |
| 19 | 병렬 브랜치 통합: action 이 미들웨어 밖에서 실행될 수 있는 구조 | 인증 미들웨어를 action 이 우회 | 미들웨어 파이프라인 안쪽에서 action → 로더. 단위 `middleware-action` |
| 20 | dev 첫 로드: 라우트 모듈이 쓰는 라이브러리(예: TanStack Query)를 Vite 가 늦게 발견 | 재최적화 중 React 두 벌 → 에러 후 강제 새로고침 | routes·Document 를 `optimizeDeps.entries` 로. 수동(캐시 비운 dev) |
| 21 | 같은 문서 해시 링크에 focus 시 데이터 프리패치 | 불필요한 `/_data` 요청 (E2E 15회 중 1회 실패) | 해시 이동은 프리패치 안 함. 단위 `client-router` |

## 4. 알려진 한계

- `useLocation().hash`·`key` 는 서버가 알 수 없어 첫 렌더에서 서버(`''`·`'default'`)와 클라가 다를 수 있다. 렌더 결과에 직접 쓰면 hydrate 불일치가 난다(effect 안에서 읽을 것).
- strip 은 `export * from './x'` 로 다시 내보낸 `loader` 와 섀도잉된 이름은 처리하지 않는다(보수적으로 남김). 서버 전용 코드는 `*.server.ts` 로 분리하는 걸 권장한다.
- 문서 스트리밍에서 settle 된 값 안의 중첩 Promise 는 지원하지 않는다(reject 로 보냄). 데이터 엔드포인트는 지원한다.

- `@vitejs/plugin-legacy` 는 지원한다(스펙 §6.6.1). 검증 범위: 태그 미러는 설치된 플러그인의 `cspHashes` 대조, 붙는 위치·nonce·HEAD 는 Node·edge 단위, 모던 Chromium 에서 레거시 번들 미요청·hydrate 1회 E2E, nomodule 브라우저는 HTML 에서 모듈 스크립트·modulepreload 를 빼고 `nomodule` 을 지운 문서로 Chromium 이 SystemJS 레거시 번들만으로 hydrate·클라 이동하는 것까지 E2E. 실제 구형 엔진(Android 5 WebView·Chrome 49)과 "모듈은 되지만 동적 import 가 없는" 브라우저의 폴백 경로는 실기기로 확인하지 않았다. `modernPolyfills` 는 엔트리보다 먼저 실행된다는 보장이 없다. `renderModernChunks: false` 는 미지원.
- `ssr-kit/edge`·Hono 는 Promise 데이터의 settle 스크립트를 응답 끝에 붙인다(스펙 §9). Promise 데이터를 쓰는 Suspense 경계의 hydrate 가 응답 끝까지 늦어진다.
- prerender 데이터 JSON 은 정적 호스팅에서 rewrite 설정이 필요하다(스펙 §6.8).
- 성능 벤치(TTFB 오버헤드, dev cold start)는 아직 측정하지 않았다.
