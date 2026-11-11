// Cloudflare Workers 데모 엔트리 — `pnpm build && pnpm demo:deploy`
// 정적 파일(dist/client)은 Workers assets 가 먼저 응답하고, 나머지를 ssr-kit/edge 가 렌더한다
import { createEdgeHandler } from 'ssr-kit/edge';
import type { ServerBuild } from 'ssr-kit/server';

// 빌드 산출물이라 타입 선언이 없다 (pnpm build 후 생김)
// @ts-expect-error -- dist/server/entry.js 는 JS 산출물
import { build as serverBuild } from './dist/server/entry.js';

const build = serverBuild as ServerBuild;

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

const handle = createEdgeHandler({
  build,
  getContext: () => ({ requestId: crypto.randomUUID() }),
});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/gold-price') {
      return Response.json({ pricePerGram: 153_000, at: new Date().toISOString() });
    }
    return (await handle(request)) ?? env.ASSETS.fetch(request);
  },
};
