# ssr-kit

Node 서버(Express·Connect·`node:http`)에 미들웨어 하나로 붙는 React 19 스트리밍 SSR 플러그인.
빌드는 Vite 8 플러그인, 런타임은 `(req, res, next)` 핸들러 하나.

- 서버는 사용자 소유 — 인증·로깅·프록시 미들웨어를 그냥 Express 코드로 쓴다
- 캐시는 HTTP 헤더로만 — 프레임워크 암묵 캐시 없음, 기본 `Cache-Control: private, no-store`
- 라우트는 코드로 선언, 로더는 라우트 모듈의 `loader` export (클라 번들에서 자동 제거)
- RSC 없이 클래식 SSR + document 전체 hydrate

문서: [PRD](https://github.com/Ahnseungc/ssr-kit/blob/main/docs/prd/ssr-kit-prd.md) · [기술 스펙](https://github.com/Ahnseungc/ssr-kit/blob/main/docs/specs/ssr-kit/spec.md)

## 빠른 시작

```ts
// vite.config.ts
import react from '@vitejs/plugin-react';
import { ssrKit } from 'ssr-kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), ssrKit({ routes: './src/routes.ts', document: './src/Document.tsx' })],
});
```

```ts
// src/routes.ts
import { defineRoutes } from 'ssr-kit';

export default defineRoutes([
  {
    id: 'root',
    module: () => import('./pages/RootLayout'),
    children: [{ path: 'gold/:id', module: () => import('./pages/GoldDetail') }],
  },
]);
```

```tsx
// src/pages/GoldDetail.tsx
import { type LoaderArgs, notFound, useLoaderData } from 'ssr-kit';

import { findGold } from '../data.server'; // *.server 파일은 클라 번들에 들어가면 빌드 에러

export const loader = async ({ params, headers }: LoaderArgs<'/gold/:id'>) => {
  const gold = await findGold(params.id);
  if (!gold) notFound();
  headers.set('Cache-Control', 'private, max-age=0');
  return { gold };
};

export const head = ({ data }: { data: { gold: { name: string } } }) => ({ title: data.gold.name });

export default function GoldDetail() {
  const { gold } = useLoaderData<typeof loader>();
  return <h1>{gold.name}</h1>;
}
```

```ts
// server.ts
import express from 'express';
import { createSsrHandler } from 'ssr-kit/node';

const app = express();
if (process.env.NODE_ENV === 'production') {
  app.use('/assets', express.static('dist/client/assets', { immutable: true, maxAge: '1y' }));
  app.use(express.static('dist/client', { index: false }));
  const { build } = await import('./dist/server/entry.js');
  app.use(createSsrHandler({ build }));
} else {
  const { createDevServer } = await import('ssr-kit/vite');
  const dev = await createDevServer({ root: import.meta.dirname });
  app.use(dev.middlewares);
  app.use(async (req, res, next) =>
    createSsrHandler({ build: await dev.getBuild() })(req, res, next),
  );
}
app.listen(3000);
```

전체 예제는 [packages/example](https://github.com/Ahnseungc/ssr-kit/tree/main/packages/example).

## 저장소 구성

| 경로 | 내용 |
|---|---|
| `packages/core` | 배포 패키지 `ssr-kit` (`ssr-kit`, `/server`, `/client`, `/node`, `/vite`) |
| `packages/example` | Express 예제 앱 + Playwright E2E |
| `docs/` | PRD·기술 스펙 |

```bash
pnpm install
pnpm build          # ssr-kit 빌드
pnpm test           # 단위 테스트 (Vitest)
pnpm example:build  # 예제 앱 빌드
pnpm e2e            # 예제 앱 prod 서버 E2E (Playwright)
```

예제 dev 서버: `pnpm --filter ssr-kit-example dev` → http://localhost:3000

## 진행 상황

구현: 코드 라우팅·우선순위·params 타입, 병렬 로더·redirect·에러 경계·헤더 병합, 스트리밍 SSR + document hydrate,
Promise 데이터 스트리밍(`use()`), 데이터 엔드포인트(`/_data/*`), head 병합, 클라 이동·프리패치·스크롤 복원, `ssr: false` 셸,
Vite 8 Environment API 빌드·dev 서버, 클라 번들 `loader` 제거·`*.server` 차단, 라우트 모듈 Fast Refresh,
CSP nonce, 저수준 `render()`, 파일 기반 라우팅(`fsRoutes`), prerender(`ssr-kit-prerender`),
어댑터 Node·Fastify·Hono·Web(`Request → Response`).

아직: Vite 에러 오버레이 연결, `renderToReadableStream` 기반 Workers 전용 경로, prerender 데이터 JSON.

| 서브패스 | 내용 |
|---|---|
| `ssr-kit` | 라우트 정의·훅·`Link`·`Outlet`·`Head` |
| `ssr-kit/node` | Express·Connect 핸들러 |
| `ssr-kit/fastify` · `ssr-kit/hono` · `ssr-kit/web` | 프레임워크 어댑터 |
| `ssr-kit/server` | `handleRequest`, 저수준 `render()` |
| `ssr-kit/client` | `hydrate`, `readSsrData` |
| `ssr-kit/vite` | `ssrKit`, `fsRoutes`, `createDevServer` |
| `ssr-kit/prerender` | `prerender()` (CLI `ssr-kit-prerender`) |

## 라이선스

MIT
