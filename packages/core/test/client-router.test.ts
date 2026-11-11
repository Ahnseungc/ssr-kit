// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createClientRouter } from '../src/client/router';
import { serialize } from '../src/core/serialize';
import type { RouteDef, SsrPayload } from '../src/core/types';
import type { RouterState } from '../src/react/context';

const routeModule = () => Promise.resolve({ default: () => null, __ssrkLoader: true as const });
const routes: RouteDef[] = ['/a', '/b', '/page'].map((path) => ({
  id: path,
  path,
  module: routeModule,
}));

const initialState = (pathname: string): RouterState => ({
  location: { pathname, search: '', hash: '', key: 'k0' },
  matches: [],
  modules: [],
  payload: { routes: [], data: {}, status: 200 },
  navigation: { state: 'idle' },
  dev: false,
});

const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body)));
const dataBody = (pathname: string, value: unknown) => ({
  type: 'data',
  payload: JSON.parse(
    serialize({
      routes: [pathname],
      data: { [pathname]: value },
      status: 200,
    } satisfies SsrPayload),
  ),
});

beforeEach(() => history.replaceState(null, '', '/page'));
afterEach(() => vi.restoreAllMocks());

describe('클라 라우터', () => {
  it('서로 redirect 하는 라우트는 10번 뒤 문서 이동으로 넘긴다 (무한 루프 방지)', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input) =>
        json({ type: 'redirect', to: String(input).includes('/a') ? '/b' : '/a', status: 302 }),
      );
    const assign = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      href: 'http://localhost/page',
      origin: 'http://localhost',
      assign,
    } as Location);
    const router = createClientRouter({
      routes,
      dataPrefix: '/_data',
      initialState: initialState('/page'),
    });
    router.actions.navigate('/a');
    await vi.waitFor(() => expect(assign).toHaveBeenCalled());
    expect(fetchMock.mock.calls.length).toBe(11);
  });

  it('revalidate 는 프리패치 데이터를 쓰지 않고 새로 요청한다', async () => {
    let version = 0;
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => json(dataBody('/page', ++version)));
    const router = createClientRouter({
      routes,
      dataPrefix: '/_data',
      initialState: initialState('/page'),
    });
    router.actions.prefetch('/page', true);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    router.actions.revalidate();
    await vi.waitFor(() => expect(router.getState().payload.data['/page']).toBe(2));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('진행 중인 이동이 있으면 revalidate 가 그 이동을 끊지 않는다', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).includes('/b')) await gate;
      return new Response(
        JSON.stringify(dataBody(String(input).includes('/b') ? '/b' : '/page', 'x')),
      );
    });
    const router = createClientRouter({
      routes,
      dataPrefix: '/_data',
      initialState: initialState('/page'),
    });
    router.actions.navigate('/b');
    await vi.waitFor(() => expect(router.getState().navigation.state).toBe('loading'));
    router.actions.revalidate();
    release();
    await vi.waitFor(() => expect(router.getState().location.pathname).toBe('/b'));
  });
});
