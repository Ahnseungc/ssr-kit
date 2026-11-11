# PRD — ssr-kit (Node 기반 React SSR 플러그인)

- 작성: 안승찬 · 2026-11-11
- 상태: Draft v0.1 (기술 결정은 [spec.md](../specs/ssr-kit/spec.md) 가 우선)
- 레포: github.com/Ahnseungc/ssr-kit

---

## 1. 배경

Next.js(App Router)로 2년 넘게 실서비스(골디 WebView 앱)를 운영하며 반복해서 부딪힌 문제가 있다. 대부분 "프레임워크가 서버를 소유한다"는 구조에서 나온다.

| # | Next.js 에서 겪는 문제 | 실제로 비용이 된 지점 |
|---|---|---|
| P1 | **서버를 내가 못 쥔다** — custom server 는 비권장, 요청·응답 객체에 직접 접근 불가, `headers()`/`cookies()` 같은 래퍼만 허용 | 인증 쿠키·프록시 헤더·로깅 미들웨어를 Next 규칙에 맞춰 우회 구현 |
| P2 | **암묵적 캐싱 정책이 메이저마다 바뀜** — fetch 기본 캐시(14) → 기본 no-store(15) → `use cache`/Cache Components(16) | 업그레이드 때마다 "왜 데이터가 안 바뀌지/왜 매번 요청하지" 디버깅 |
| P3 | **Server/Client 경계 비용** — `'use client'` 전파, 직렬화 불가 props, RSC payload 가 HTML 과 중복 전송 | 단순 페이지도 경계 설계부터 고민, HTML 크기 증가 |
| P4 | **파일 컨벤션 강제** — `page`/`layout`/`loading`/`error`/`route group`/`parallel route` 등 | 라우트 구조가 디렉토리 구조에 묶여 리팩터링 비용 큼 |
| P5 | **빌드·dev 서버가 무겁다** — 대형 앱에서 cold start·메모리·빌드 시간 | 로컬 HMR 지연, CI 빌드 시간 |
| P6 | **Self-host 시 2급 시민** — ISR 캐시 공유, 이미지 최적화, 멀티 인스턴스 캐시 핸들러를 직접 구성 | Vercel 밖 배포에서 기능별 별도 설정 |
| P7 | **번들러 설정 불투명** — webpack/Turbopack 설정 커스텀이 제한적, 결과물 구조 예측 어려움 | 구형 Android WebView 타겟 트랜스파일·폴리필 제어 어려움 |
| P8 | **디버깅 난이도** — 하이드레이션 에러, 서버 컴포넌트 스택트레이스, 빌드 단계별 에러 | 원인 추적에 시간 소모 |

React 자체는 `renderToPipeableStream`, `hydrateRoot`, Suspense 스트리밍을 이미 제공한다. 필요한 건 **"이 API 들을 Node 서버에 붙이는 얇은 접착층"** 이지 서버를 통째로 가져가는 프레임워크가 아니다.

## 2. 한 줄 정의

> **내 Node 서버(Express/Fastify/Hono/`node:http`)에 미들웨어 하나로 붙는 React 19 스트리밍 SSR 플러그인.** 빌드는 Vite 플러그인, 런타임은 순수 함수.

## 3. 목표 / 비목표

### 목표
- G1. 서버 소유권은 사용자에게 — 플러그인은 `(req, res) => Promise<void>` 핸들러 하나만 제공한다. (P1, P6)
- G2. 캐싱은 **HTTP 헤더로만** — 프레임워크 레벨 암묵 캐시 없음. 라우트가 `Cache-Control` 을 직접 반환. (P2)
- G3. 클래식 SSR + 하이드레이션 모델을 기본으로 — 모든 컴포넌트는 서버·클라이언트 양쪽에서 실행 가능한 일반 React 컴포넌트. (P3)
- G4. 라우팅은 **코드로 선언**(배열/객체)이 기본, 파일 기반은 선택형 플러그인. (P4)
- G5. 빌드는 Vite 그대로 노출 — 사용자의 `vite.config` 가 진실의 원천. (P5, P7)
- G6. 에러는 원본 소스맵 스택과 함께, 하이드레이션 불일치는 dev 에서 diff 로 표시. (P8)
- G7. 코어(런타임) 의존성 최소 — `react`, `react-dom` peer 외 런타임 의존성 0 지향.

### 비목표 (v1)
- React Server Components / Server Actions — v1 제외. 수요 확인 후 v2 실험 기능으로 검토.
- 이미지 최적화, 폰트 최적화, 미들웨어 런타임 등 "올인원" 기능 — 생태계 라이브러리 사용.
- Edge/Workers 런타임 — v1 은 Node 22+ 전용. (Web Stream 어댑터는 M4 이후 검토)
- 정적 사이트 생성(SSG) 전용 기능 — `prerender` 스크립트 수준만 제공.

## 4. 대상 사용자

- 1차: 나 — Next 에서 이탈하려는 WebView/모바일 웹 서비스 개발자. 기존 Express/Nest 백엔드나 BFF 에 SSR 을 얹고 싶음.
- 2차: Vite SPA 를 운영 중인데 SEO·초기 로딩 때문에 SSR 만 추가하고 싶은 팀.

## 5. 경쟁 비교 (왜 직접 만드는가)

| | Next.js | React Router v7 (framework) | Vike | **ssr-kit** |
|---|---|---|---|---|
| 서버 소유 | 프레임워크 | 어댑터 경유 | 사용자 | **사용자** |
| 라우팅 | 파일 강제 | 파일/설정 | 파일 | **코드 기본, 파일 선택** |
| 캐싱 | 프레임워크 캐시 | HTTP | HTTP | **HTTP 만** |
| RSC | 기본 | 실험 | 확장 | v1 없음 |
| 번들러 | Turbopack/webpack | Vite | Vite | Vite |
| 코어 크기 | 대형 | 중형 | 중형 | **소형 목표** |

React Router v7·Vike 가 가장 가까운 대안이다. 차별점은 ① 라우터·데이터 규약을 강제하지 않는 **미들웨어 퍼스트**, ② 기능을 줄여 코어를 읽고 고칠 수 있는 크기(목표 3k LOC 이하)로 유지하는 것. 만들다 이 차별점이 사라지면 Vike/RR7 채택으로 전환한다(§12 Kill criteria).

## 6. 사용자 시나리오

1. **기존 Express 서버에 SSR 추가**
   ```ts
   import express from 'express';
   import { createSsrHandler } from 'ssr-kit/node';
   import { routes } from './routes';

   const app = express();
   app.use('/api', apiRouter);           // 내 API 는 그대로
   app.use(authMiddleware);              // 내 미들웨어도 그대로
   app.get('*', createSsrHandler({ routes }));
   app.listen(3000);
   ```
2. **라우트 정의 — 코드로, 로더는 라우트 모듈에**
   ```ts
   // routes.ts
   export const routes = defineRoutes([
     { path: '/gold/:id', module: () => import('./pages/GoldDetail') },
   ]);

   // pages/GoldDetail.tsx — loader 는 빌드 시 클라 번들에서 제거
   export const loader = async ({ params, request, headers }: LoaderArgs<'/gold/:id'>) => {
     headers.set('Cache-Control', 'private, max-age=0');
     return { data: await fetchGold(params.id, { cookie: request.headers.get('cookie') }) };
   };
   export const head = ({ data }: HeadArgs<typeof loader>) => ({ title: data.data.name });
   export default function GoldDetail() { /* useLoaderData<typeof loader>() */ }
   ```
3. **컴포넌트에서 데이터 사용** — `useLoaderData<typeof loader>()`, 타입 자동 추론.
4. **클라이언트 이동** — `<Link>` 클릭 시 `/_data?path=...` JSON 요청 → 로더만 실행 → 클라이언트 렌더. 전체 문서 새로고침 없음.
5. **dev** — `vite` dev 서버를 미들웨어 모드로 내 서버에 붙임. 서버 코드·컴포넌트 HMR.

## 7. 기능 요구사항

우선순위: **P0** = MVP 필수 · **P1** = v1.0 · **P2** = 이후

### 7.1 렌더링
| ID | 요구사항 | 우선 |
|---|---|---|
| R1 | `renderToPipeableStream` 기반 스트리밍 SSR, `onShellReady` 에서 헤더 flush | P0 |
| R2 | Suspense 경계 단위 점진 스트리밍 (로더 Promise 를 `use()` 로 소비 가능) | P1 |
| R3 | 봇/크롤러 UA 는 `onAllReady` 까지 대기 후 응답(옵션) | P1 |
| R4 | 렌더 타임아웃(`abortDelay`) 설정, 초과 시 클라이언트 렌더 폴백 | P0 |
| R5 | `hydrateRoot` + 하이드레이션 불일치 dev 경고에 서버/클라 HTML diff 표시 | P1 |
| R6 | 라우트 단위 `ssr: false` (SPA 셸만 내려주기) | P1 |

### 7.2 라우팅
| ID | 요구사항 | 우선 |
|---|---|---|
| RT1 | `defineRoutes()` 코드 기반 라우트, 중첩 레이아웃(`children`) 지원 | P0 |
| RT2 | 동적 파라미터·와일드카드·옵셔널 세그먼트, 타입 추론 | P0 |
| RT3 | 라우트 단위 코드 스플리팅 (`component: () => import()`) | P0 |
| RT4 | 클라이언트 네비게이션 `<Link>`, `useNavigate`, 프리패치(hover/viewport) | P0 |
| RT5 | 파일 기반 라우팅은 별도 Vite 플러그인(`ssr-kit/fs-routes`)으로 라우트 배열 생성 | P2 |
| RT6 | 외부 라우터(TanStack Router 등) 연결용 `render(url, ctx)` 저수준 API | P1 |

### 7.3 데이터
| ID | 요구사항 | 우선 |
|---|---|---|
| D1 | 라우트 `loader({ params, req, res, signal })` — 서버 전용, 클라 번들에서 제거 | P0 |
| D2 | 중첩 라우트 로더 **병렬 실행** (waterfall 금지) | P0 |
| D3 | 로더 결과 직렬화 — JSON + Date/Map/Set/BigInt 지원, XSS 안전 이스케이프 | P0 |
| D4 | `redirect()`, `notFound()`, 상태코드·헤더 반환 | P0 |
| D5 | TanStack Query dehydrate/hydrate 연동 레시피 (코어 아님, 예제) | P1 |
| D6 | 클라이언트 네비게이션용 데이터 엔드포인트 (경로 prefix 설정 가능) | P0 |

### 7.4 문서·에셋
| ID | 요구사항 | 우선 |
|---|---|---|
| A1 | `head()` 로 title/meta/link 선언, 중첩 라우트 병합 (React 19 `<title>` 호이스팅도 허용) | P0 |
| A2 | Vite manifest 기반 현재 라우트 JS/CSS `modulepreload`·`<link rel=stylesheet>` 주입 | P0 |
| A3 | CSP nonce 주입 옵션 (`nonce` 를 인라인 스크립트·스타일에 전달) | P1 |
| A4 | HTML 템플릿 커스텀 (`Document` 컴포넌트 교체) | P0 |

### 7.5 에러
| ID | 요구사항 | 우선 |
|---|---|---|
| E1 | 라우트 `errorBoundary` — 로더·렌더 에러를 같은 경계로 처리 | P0 |
| E2 | 셸 렌더 전 에러는 500 + 루트 에러 컴포넌트, 이후 에러는 Suspense 경계 폴백 | P0 |
| E3 | `onError(err, ctx)` 훅 — 사용자 로거(Sentry 등)로 위임 | P0 |
| E4 | dev 에러 오버레이 (Vite overlay 재사용, 소스맵 스택) | P1 |

### 7.6 빌드·dev
| ID | 요구사항 | 우선 |
|---|---|---|
| B1 | Vite 플러그인 `ssrKit()` — client/server 두 환경 빌드 (Vite Environment API) | P0 |
| B2 | 서버 번들에서 `.client.ts`, 클라 번들에서 `.server.ts` 및 `loader` 제거 | P0 |
| B3 | dev: Vite 미들웨어 모드 + `ssrLoadModule`/모듈 러너로 서버 코드 HMR | P0 |
| B4 | 브라우저 타겟은 사용자 `build.target`/`@vitejs/plugin-legacy` 그대로 존중 | P0 |
| B5 | 빌드 산출물: `dist/client`(정적), `dist/server/entry.js`(핸들러 export) | P0 |
| B6 | `ssr-kit prerender <paths>` — 지정 경로 정적 HTML 생성 | P2 |

### 7.7 어댑터
| ID | 요구사항 | 우선 |
|---|---|---|
| AD1 | `node:http` 기본 핸들러 (Express/Connect 호환 시그니처) | P0 |
| AD2 | Fastify 플러그인, Hono 핸들러 | P1 |
| AD3 | Web `Request → Response` 어댑터 (Bun/Deno/Workers 대비) | P2 |

## 8. 비기능 요구사항

| 항목 | 목표 |
|---|---|
| 코어 런타임 크기 | 서버 런타임 < 30KB(min), 클라 런타임 < 8KB(min+gz) |
| SSR 오버헤드 | 동일 컴포넌트 기준 순수 `renderToPipeableStream` 대비 TTFB +5ms 이내 |
| dev cold start | 100 라우트 기준 < 1.5s |
| 프로덕션 빌드 | 동일 앱 Next 대비 50% 이하 시간 (골디 일부 페이지 이식으로 측정) |
| 호환 | Node 22 LTS+, React 19.x, Vite 8+ |
| 타입 | 라우트 파라미터·로더 데이터 end-to-end 타입 추론, `any` 노출 0 |
| 테스트 | 코어 커버리지 90%+, 렌더 결과 스냅샷 + Playwright E2E 예제 앱 |
| 보안 | 직렬화 데이터 `</script>` 이스케이프, 로더 코드 클라 번들 유출 0 (빌드 시 검증) |

## 9. 아키텍처

```
[사용자 Node 서버]
   │  app.get('*', handler)
   ▼
createSsrHandler ──► matchRoutes(url) ──► runLoaders (병렬, AbortSignal)
   │                                         │ redirect/notFound → 즉시 응답
   ▼                                         ▼
renderToPipeableStream(<Document><Router initial={match,data}/></Document>)
   │  onShellReady → status/headers flush → pipe(res)
   ▼
HTML  + <script>window.__SSR_DATA__</script> + modulepreload(manifest)
   ▼
[브라우저] hydrateRoot → 이후 <Link> 이동 = GET {dataPrefix}?path= → 로더만 실행
```

패키지 구성(pnpm 모노레포, WebViewKit 레포와 같은 구조):
- `packages/core` — 배포 패키지 `ssr-kit`. 서브패스 `ssr-kit`(공용) · `/server` · `/client` · `/node` · `/vite`
- `packages/example` — Express 예제 앱 + E2E
- Fastify·Hono 어댑터는 P1 에 `ssr-kit/fastify`, `ssr-kit/hono` 서브패스로 추가

설계 원칙:
1. **모든 확장 지점은 함수 인자** — 전역 설정 파일·매직 export 없음.
2. **요청 컨텍스트는 명시적으로 전달** — 로더 인자로 `req`/`res`, 컴포넌트는 `useRequestContext()`(서버에서만 값 존재).
3. **캐시는 사용자 몫** — 필요하면 로더 안에서 `lru-cache`/Redis 를 직접 사용.

## 10. 마일스톤

| 단계 | 범위 | 완료 기준 |
|---|---|---|
| M0 (1주) | 스파이크 — Express + Vite 미들웨어 모드 + 스트리밍 SSR + hydrate | 한 페이지가 dev/prod 둘 다 스트리밍 렌더 |
| M1 (3주) | MVP — P0 전부 (라우팅·로더·head·에러·빌드·node 어댑터) | 예제 앱 3라우트, 클라 이동, 타입 추론 동작 |
| M2 (2주) | 골디 일부 페이지 이식 실험 (공지·이벤트 상세 등 읽기 위주 화면) | Next 대비 TTFB·빌드 시간·번들 크기 비교 리포트 |
| M3 (2주) | P1 — Fastify/Hono, CSP nonce, 봇 대기, 하이드레이션 diff, 프리패치 | v1.0 npm 배포, 문서 사이트 |
| M4 | P2 — 파일 라우팅, prerender, Web 어댑터, RSC 실험 검토 | 수요 기반 |

## 11. 성공 지표

- M2 비교에서 다음 중 2개 이상 충족: 빌드 시간 50%↓, 첫 HTML 크기 30%↓(RSC payload 제거 효과), dev cold start 50%↓
- 서버 미들웨어(인증·로깅·프록시 헤더)를 Next 우회 없이 일반 Express 코드로 작성 가능
- 코어 LOC 3,000 이하 유지 — 혼자 전체를 읽고 디버깅 가능

## 12. 리스크 / Kill criteria

| 리스크 | 대응 |
|---|---|
| 결국 RR7/Vike 를 다시 만드는 것 | M1 끝에서 RR7 framework mode·Vike 로 같은 예제를 만들어 비교. 차별점(미들웨어 퍼스트·코어 크기)이 체감되지 않으면 중단하고 채택 |
| Vite Environment API 변화 | Vite 메이저 고정, 환경 API 사용부를 `ssr-kit/vite` 안에 격리 |
| RSC 생태계 쏠림 (라이브러리들이 RSC 전제) | 클래식 SSR 로 충분한 서비스 유형(WebView·내부 툴·콘텐츠)에 포지셔닝, RSC 는 v2 검토 |
| 1인 유지보수 | 기능 추가보다 범위 축소 우선, 비목표 목록을 README 에 명시 |
| 스트리밍 + 구형 WebView 호환 | M2 에서 구형 Android WebView 실기기 검증, 문제 시 `onAllReady` 모드 기본값 전환 옵션 |

## 13. 미결 질문

1. 패키지 이름 — `ssr-kit` 확정 (2026-11-11 npm `ssr-kit`·`ssrkit`·`ssr_kit` 미사용 확인). 첫 배포 전까지 선점 안 되면 그대로 사용, 막히면 개인 스코프 `@ahnseungchan/ssr-kit` 으로 (2026-11-11 미사용 확인).
2. 데이터 엔드포인트 방식 — `?_data` 쿼리 vs `/_data/*` prefix vs `Accept` 헤더 협상.
3. 로더 타입 추론 — `typeof loader` 제네릭 vs 라우트 ID 기반 레지스트리(TanStack 방식).
4. 클라이언트 라우터를 자체 구현할지, 외부 라우터를 1급으로 지원하고 자체는 최소로 둘지.
5. 라이선스 — MIT 예정.
