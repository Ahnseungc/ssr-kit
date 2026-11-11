import { describe, expect, it, vi } from 'vitest';

import { redirect } from '../src/core/errors';
import type { RouteModule } from '../src/core/types';
import { DefaultDocument, Outlet } from '../src/react/components';
import { useActionData } from '../src/react/hooks';
import type { ServerBuild } from '../src/server/build';
import { createWebHandler } from '../src/web/index';

const action = vi.fn(async ({ context }: { context: { user?: string } }) => ({
  savedBy: context.user,
}));

const Page = () => <p id="saved">{JSON.stringify(useActionData() ?? null)}</p>;

const modules: Record<string, RouteModule> = {
  guard: {
    default: () => <Outlet />,
    middleware: ({ request, context }) => {
      const user = request.headers.get('x-user');
      if (!user) redirect('/login');
      (context as { user?: string }).user = user!;
    },
  },
  memo: { default: Page, action: action as unknown as RouteModule['action'] },
};

const build: ServerBuild = {
  routes: [
    {
      id: 'guard',
      module: () => Promise.resolve(modules.guard!),
      children: [{ id: 'memo', path: 'memo', module: () => Promise.resolve(modules.memo!) }],
    },
  ],
  Document: DefaultDocument,
  dataPrefix: '/_data',
  dev: false,
  bootstrapModules: [],
  resolveAssets: () => ({ modules: [], styles: [] }),
};

const handle = createWebHandler({ build, serverTiming: true });
const post = (path: string, headers: Record<string, string> = {}) =>
  handle(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      body: new URLSearchParams({ text: '메모' }),
      headers: { origin: 'http://localhost', ...headers },
    }),
  );

describe('미들웨어가 action 을 감싼다', () => {
  it('미들웨어가 막으면 action 을 실행하지 않는다 (문서·데이터 요청)', async () => {
    action.mockClear();
    const doc = (await post('/memo'))!;
    expect(doc.status).toBe(302);
    expect(doc.headers.get('location')).toBe('/login');
    const data = (await post('/_data/memo'))!;
    expect(await data.json()).toMatchObject({ type: 'redirect', to: '/login' });
    expect(action).not.toHaveBeenCalled();
  });

  it('통과하면 미들웨어가 붙인 context 로 action 이 돌고 Server-Timing 에 미들웨어 시간이 실린다', async () => {
    action.mockClear();
    const doc = (await post('/memo', { 'x-user': 'kim' }))!;
    expect(doc.status).toBe(200);
    expect(await doc.text()).toContain('{&quot;savedBy&quot;:&quot;kim&quot;}');
    expect(action).toHaveBeenCalledOnce();
    expect(doc.headers.get('server-timing')).toMatch(/\bmw;dur=/);
  });
});
