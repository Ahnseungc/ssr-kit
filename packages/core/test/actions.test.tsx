import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { findActionIndex, isActionMethod, isTrustedOrigin } from '../src/core/actions';
import { httpError, redirect } from '../src/core/errors';
import { deserialize } from '../src/core/serialize';
import type { ActionArgs, RouteError, RouteModule, SsrPayload } from '../src/core/types';
import { createSsrHandler } from '../src/node/index';
import { DefaultDocument, Outlet } from '../src/react/components';
import { useActionData, useLoaderData } from '../src/react/hooks';
import type { ServerBuild } from '../src/server/build';

let memos: string[] = [];
let layoutLoads = 0;

const memoAction = async ({ request, headers }: ActionArgs<'/memo'>) => {
  const form = await request.formData();
  // 본문은 한 번만 소비하지만 다시 읽어도 같은 값
  const again = await request.formData();
  const text = String(form.get('text') ?? '');
  if (form.get('intent') === 'boom') throw new Error('action 폭발');
  if (form.get('intent') === 'deny') httpError(422, '입력을 확인해 주세요');
  if (!text.trim()) return { error: '내용을 입력해 주세요', same: again.get('text') === text };
  memos.push(text);
  headers.append('set-cookie', 'flash=saved; Path=/');
  if (form.get('intent') === 'go') redirect('/memo?saved=1');
  return { ok: true, count: memos.length };
};

const Memo = () => {
  const { memos: list } = useLoaderData<() => { memos: string[] }>();
  const result = useActionData<typeof memoAction>();
  return (
    <main>
      <ul id="memos">{list.join(',')}</ul>
      <p id="result">{JSON.stringify(result ?? null)}</p>
    </main>
  );
};

const Layout = () => (
  <div id="layout">
    <Outlet />
  </div>
);

const Boundary = ({ error }: { error: RouteError }) => (
  <p id="boundary">{`${error.status}:${error.message}`}</p>
);

const modules: Record<string, RouteModule> = {
  layout: {
    default: Layout,
    loader: () => ({ loads: ++layoutLoads }),
    action: () => ({ from: 'layout' }),
  },
  memo: {
    default: Memo,
    loader: () => ({ memos: [...memos] }),
    action: memoAction,
    ErrorBoundary: Boundary,
  },
  json: {
    default: () => <p id="json">{JSON.stringify(useActionData())}</p>,
    action: async ({ request, params }) => ({ body: await request.json(), id: params.id }),
  },
  plain: { default: () => <p>plain</p> },
};

const build: ServerBuild = {
  routes: [
    {
      id: 'layout',
      module: () => Promise.resolve(modules.layout!),
      children: [
        { id: 'memo', path: 'memo', module: () => Promise.resolve(modules.memo!) },
        { id: 'json', path: 'json/:id', module: () => Promise.resolve(modules.json!) },
        { id: 'plain', path: 'plain', module: () => Promise.resolve(modules.plain!) },
      ],
    },
  ],
  Document: DefaultDocument,
  dataPrefix: '/_data',
  dev: false,
  bootstrapModules: [],
  resolveAssets: () => ({ modules: [], styles: [] }),
};

const onError = vi.fn();
const handler = createSsrHandler({
  build,
  onError,
  allowedOrigins: ['https://app.example.com'],
});
// 레이아웃에만 action 이 없는 빌드 — action 없는 라우트 POST 를 next() 로 넘기는지
const plainHandler = createSsrHandler({
  build: { ...build, routes: [build.routes[0]!.children![2]!] },
});

let server: Server;
let base = '';
const nextCalls: string[] = [];

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const next = req.headers['x-next']
      ? () => {
          nextCalls.push(`${req.method} ${req.url}`);
          res.statusCode = 418;
          res.end('next');
        }
      : undefined;
    const target = req.headers['x-plain'] ? plainHandler : handler;
    void target(req, res, next);
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

beforeEach(() => {
  memos = [];
  onError.mockClear();
});

const post = (path: string, body: BodyInit, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    body,
    headers: { origin: base, ...headers },
    redirect: 'manual',
  });

const form = (values: Record<string, string>) => new URLSearchParams(values);

const readData = async (response: Response) => {
  const body = (await response.json()) as { type: string; payload: unknown[] };
  return deserialize<SsrPayload>(body.payload);
};

describe('action (문서 요청)', () => {
  it('urlencoded 폼: action 후 로더를 다시 돌려 actionData 와 함께 렌더한다', async () => {
    const response = await post('/memo', form({ text: '첫 메모' }));
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual(['flash=saved; Path=/']);
    const html = await response.text();
    expect(html).toContain('<ul id="memos">첫 메모</ul>');
    expect(html).toContain('{&quot;ok&quot;:true,&quot;count&quot;:1}');
    expect(html).toContain('actionData');
  });

  it('검증 실패를 actionData 로 돌려준다 (본문을 두 번 읽어도 같다)', async () => {
    const html = await (await post('/memo', form({ text: ' ' }))).text();
    expect(html).toContain('내용을 입력해 주세요');
    expect(html).toContain('&quot;same&quot;:true');
    expect(memos).toEqual([]);
  });

  it('multipart 본문도 formData() 로 읽는다', async () => {
    const body = new FormData();
    body.append('text', '멀티파트');
    body.append('file', new Blob(['x']), 'a.txt');
    const response = await post('/memo', body);
    expect(response.status).toBe(200);
    expect(memos).toEqual(['멀티파트']);
  });

  it('JSON 본문과 params 를 받는다', async () => {
    const response = await post('/json/7', JSON.stringify({ a: 1 }), {
      'content-type': 'application/json',
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(
      '{&quot;body&quot;:{&quot;a&quot;:1},&quot;id&quot;:&quot;7&quot;}',
    );
  });

  it('redirect() 는 303 으로 바꾸고 action 헤더를 유지한다', async () => {
    const response = await post('/memo', form({ text: 'x', intent: 'go' }));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/memo?saved=1');
    expect(response.headers.getSetCookie()).toEqual(['flash=saved; Path=/']);
    expect(memos).toEqual(['x']);
  });

  it('httpError 는 가장 가까운 ErrorBoundary 와 그 상태, 위쪽 로더 데이터는 채운다', async () => {
    const response = await post('/memo', form({ intent: 'deny' }));
    expect(response.status).toBe(422);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const html = await response.text();
    expect(html).toContain('<p id="boundary">422:입력을 확인해 주세요</p>');
    expect(html).toContain('id="layout"');
    expect(onError).not.toHaveBeenCalled();
  });

  it('일반 Error 는 500, prod 메시지 숨김, onError(phase: action)', async () => {
    const response = await post('/memo', form({ intent: 'boom' }));
    expect(response.status).toBe(500);
    const html = await response.text();
    expect(html).toContain('500:Internal Server Error');
    expect(html).not.toContain('action 폭발');
    expect(onError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ phase: 'action' }),
    );
  });

  it('리프에 action 이 없으면 가장 가까운 상위 라우트 action 을 실행한다', async () => {
    expect((await post('/plain', form({}))).status).toBe(200);
    const payload = await readData(await post('/_data/plain', form({})));
    expect(payload.actionData).toEqual({ from: 'layout' });
  });

  it('action 이 없으면 next() 로 넘기고, next 가 없으면 405', async () => {
    const passed = await post('/plain', form({}), { 'x-plain': '1', 'x-next': '1' });
    expect(passed.status).toBe(418);
    expect(nextCalls).toContain('POST /plain');
    expect((await post('/plain', form({}), { 'x-plain': '1' })).status).toBe(405);
  });

  it('매치가 없는 POST 는 next() (사용자 API 라우트), 없으면 405', async () => {
    const passed = await post('/api/memo', form({}), { 'x-next': '1' });
    expect(passed.status).toBe(418);
    expect(nextCalls).toContain('POST /api/memo');
    expect((await post('/api/memo', form({}))).status).toBe(405);
  });

  it('OPTIONS 등 action 메서드가 아니면 405', async () => {
    const response = await fetch(`${base}/memo`, { method: 'OPTIONS' });
    expect(response.status).toBe(405);
  });
});

describe('action CSRF', () => {
  it('다른 Origin 은 403, action 을 실행하지 않는다', async () => {
    const response = await post('/memo', form({ text: 'x' }), { origin: 'https://evil.test' });
    expect(response.status).toBe(403);
    expect(memos).toEqual([]);
  });

  it('Origin 이 없으면 Referer 로 판단하고, 둘 다 없으면 403', async () => {
    const ok = await fetch(`${base}/memo`, {
      method: 'POST',
      body: form({ text: 'r' }),
      headers: { referer: `${base}/memo` },
    });
    expect(ok.status).toBe(200);
    const none = await fetch(`${base}/memo`, { method: 'POST', body: form({ text: 'n' }) });
    expect(none.status).toBe(403);
    expect(memos).toEqual(['r']);
  });

  it('allowedOrigins 에 있으면 허용한다', async () => {
    const response = await post('/memo', form({ text: 'a' }), {
      origin: 'https://app.example.com',
    });
    expect(response.status).toBe(200);
  });
});

describe('action (데이터 요청)', () => {
  it('POST /_data 는 actionData 와 새 로더 데이터를 JSON 으로', async () => {
    const before = layoutLoads;
    const response = await post('/_data/memo', form({ text: '데이터' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    const payload = await readData(response);
    expect(payload.actionData).toEqual({ ok: true, count: 1 });
    expect(payload.data.memo).toEqual({ memos: ['데이터'] });
    expect(payload.data.layout).toEqual({ loads: before + 1 });
  });

  it('redirect 는 HTTP 200 + type: redirect (303)', async () => {
    const response = await post('/_data/memo', form({ text: 'x', intent: 'go' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ type: 'redirect', to: '/memo?saved=1', status: 303 });
  });

  it('action 에러는 payload.error 와 그 상태', async () => {
    const response = await post('/_data/memo', form({ intent: 'deny' }));
    expect(response.status).toBe(422);
    const payload = await readData(response);
    expect(payload.error).toEqual({
      routeId: 'memo',
      error: { status: 422, message: '입력을 확인해 주세요' },
    });
    expect(payload.routes).toEqual(['layout', 'memo']);
  });

  it('action 이 없거나 출처가 다르면 거절, 매치가 없으면 404', async () => {
    const plain = await post('/_data/plain', form({}), { 'x-plain': '1', 'x-next': '1' });
    expect(plain.status).toBe(405);
    const evil = await post('/_data/memo', form({}), { origin: 'https://evil.test' });
    expect(evil.status).toBe(403);
    expect((await post('/_data/nope', form({}))).status).toBe(404);
    const head = await fetch(`${base}/_data/memo`, { method: 'HEAD' });
    expect(head.status).toBe(405);
  });
});

describe('action 헬퍼', () => {
  it('isActionMethod·findActionIndex', () => {
    expect(['post', 'PUT', 'PATCH', 'DELETE'].every(isActionMethod)).toBe(true);
    expect(isActionMethod('GET')).toBe(false);
    expect(findActionIndex([modules.layout!, modules.memo!, modules.plain!])).toBe(1);
    expect(findActionIndex([modules.plain!])).toBe(-1);
  });

  it('isTrustedOrigin: scheme 이 달라도 host 가 같으면 허용(TLS 종료 프록시), "null" 은 거절', () => {
    const request = (headers: Record<string, string>) => ({
      url: new URL('http://shop.test/memo'),
      method: 'POST',
      headers: new Headers(headers),
      raw: null,
    });
    expect(isTrustedOrigin(request({ origin: 'https://shop.test' }))).toBe(true);
    expect(isTrustedOrigin(request({ origin: 'null' }))).toBe(false);
    expect(isTrustedOrigin(request({ referer: 'not a url' }))).toBe(false);
    expect(isTrustedOrigin(request({ origin: 'https://shop.test.evil.com' }))).toBe(false);
  });
});
