// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createClientRouter } from '../src/client/router';
import { serialize } from '../src/core/serialize';
import type { RouteDef, SsrPayload } from '../src/core/types';
import { Form } from '../src/react/components';
import { type RouterActions, RouterActionsContext, type RouterState } from '../src/react/context';

const routeModule = () => Promise.resolve({ default: () => null, __ssrkLoader: true as const });
const routes: RouteDef[] = ['/memo', '/done'].map((path) => ({
  id: path,
  path,
  module: routeModule,
}));

const initialState = (pathname: string): RouterState => ({
  location: { pathname, search: '', hash: '', key: 'k0', state: { from: 'test' } },
  matches: [],
  modules: [],
  payload: { routes: [], data: {}, status: 200 },
  navigation: { state: 'idle' },
  dev: false,
});

const jsonResponse = (body: unknown) => new Response(JSON.stringify(body));
const dataBody = (payload: SsrPayload) => ({
  type: 'data',
  payload: JSON.parse(serialize(payload)),
});

const createRouter = () =>
  createClientRouter({ routes, dataPrefix: '/_data', initialState: initialState('/memo') });

beforeEach(() => history.replaceState({ key: 'k0' }, '', '/memo'));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('클라 라우터 submit', () => {
  it('submitting 상태를 거쳐 actionData·새 로더 데이터로 바꾸고, 같은 주소면 기록을 쌓지 않는다', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      await gate;
      return jsonResponse(
        dataBody({
          routes: ['/memo'],
          data: { '/memo': { memos: ['a'] } },
          status: 200,
          actionData: { ok: true },
        }),
      );
    });
    const pushState = vi.spyOn(history, 'pushState');
    const router = createRouter();
    const done = router.actions.submit({ text: 'a' });

    const navigation = router.getState().navigation;
    expect(navigation.state).toBe('submitting');
    expect(navigation.formMethod).toBe('POST');
    expect(navigation.location).toBe('/memo');
    expect(navigation.formData?.get('text')).toBe('a');

    release();
    await done;
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/_data/memo');
    expect(init?.method).toBe('POST');
    // 파일이 없으면 JS 없는 폼과 같은 urlencoded
    expect(init?.body).toBeInstanceOf(URLSearchParams);
    expect(String(init?.body)).toBe('text=a');

    const state = router.getState();
    expect(state.navigation.state).toBe('idle');
    expect(state.payload.actionData).toEqual({ ok: true });
    expect(state.payload.data['/memo']).toEqual({ memos: ['a'] });
    expect(state.location.state).toEqual({ from: 'test' });
    expect(pushState).not.toHaveBeenCalled();
  });

  it('파일이 있으면 FormData(multipart) 그대로, 다른 경로 action 은 push', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(dataBody({ routes: ['/done'], data: {}, status: 200 })));
    const router = createRouter();
    const body = new FormData();
    body.append('file', new Blob(['x']), 'a.txt');
    await router.actions.submit(body, { action: '/done', method: 'put' });
    expect(fetchMock.mock.calls[0]![1]?.body).toBe(body);
    expect(fetchMock.mock.calls[0]![1]?.method).toBe('PUT');
    expect(window.location.pathname).toBe('/done');
    expect(router.getState().location.pathname).toBe('/done');
  });

  it('redirect 응답은 GET 데이터 요청으로 따라간다', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) =>
        String(input) === '/_data/done'
          ? jsonResponse(dataBody({ routes: ['/done'], data: { '/done': 1 }, status: 200 }))
          : jsonResponse({ type: 'redirect', to: '/done', status: 303 }),
      );
    const router = createRouter();
    await router.actions.submit({ text: 'b' });
    await vi.waitFor(() => expect(router.getState().location.pathname).toBe('/done'));
    expect(fetchMock.mock.calls[1]![1]?.method).toBeUndefined();
    expect(router.getState().payload.actionData).toBeUndefined();
  });

  it('method get 은 쿼리로 바꿔 이동한다', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(dataBody({ routes: ['/memo'], data: {}, status: 200 })));
    const router = createRouter();
    await router.actions.submit({ q: '금' }, { method: 'get' });
    expect(fetchMock.mock.calls[0]![0]).toBe('/_data/memo?q=%EA%B8%88');
    expect(router.getState().location.search).toBe('?q=%EA%B8%88');
  });

  it('네트워크 실패는 idle 로 되돌리고 reject, 다른 origin 은 거절', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
    const router = createRouter();
    await expect(router.actions.submit({ a: '1' })).rejects.toThrow('offline');
    expect(router.getState().navigation.state).toBe('idle');
    await expect(
      router.actions.submit({ a: '1' }, { action: 'https://evil.test/x' }),
    ).rejects.toThrow(/origin/);
  });

  it('이동이 submit 을 끊으면 늦게 온 action 응답은 버린다', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (init?.method === 'POST') {
        await gate;
        if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      }
      return jsonResponse(
        dataBody({ routes: [String(input).slice(6)], data: {}, status: 200, actionData: 'late' }),
      );
    });
    const router = createRouter();
    const submitted = router.actions.submit({ a: '1' });
    router.actions.navigate('/done');
    await vi.waitFor(() => expect(router.getState().location.pathname).toBe('/done'));
    release();
    await submitted;
    expect(router.getState().location.pathname).toBe('/done');
  });
});

describe('<Form>', () => {
  const renderForm = (ui: ReactNode) => {
    const submit = vi.fn<RouterActions['submit']>(() => Promise.resolve());
    const actions: RouterActions = {
      navigate: vi.fn(),
      revalidate: vi.fn(),
      prefetch: vi.fn(),
      submit,
    };
    render(<RouterActionsContext value={actions}>{ui}</RouterActionsContext>);
    return submit;
  };

  it('실제 <form method="post"> 를 렌더하고 제출을 가로채 누른 버튼 값까지 보낸다', async () => {
    const submit = renderForm(
      <Form method="post" action="/memo" replace data-testid="form">
        <input name="text" defaultValue="안녕" />
        <button type="submit" name="intent" value="save">
          저장
        </button>
      </Form>,
    );
    const form = screen.getByTestId('form');
    expect(form.getAttribute('method')).toBe('post');
    expect(form.getAttribute('action')).toBe('/memo');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '저장' })));
    expect(submit).toHaveBeenCalledTimes(1);
    const [formData, options] = submit.mock.calls[0]!;
    expect((formData as FormData).get('text')).toBe('안녕');
    expect((formData as FormData).get('intent')).toBe('save');
    expect(options).toEqual({ method: 'post', action: '/memo', replace: true });
  });

  it('put·delete 도 JS 없이 제출되도록 method 속성은 post', () => {
    renderForm(<Form method="delete" data-testid="form" />);
    expect(screen.getByTestId('form').getAttribute('method')).toBe('post');
  });

  it('reloadDocument·다른 origin·target=_blank·onSubmit 에서 막으면 가로채지 않는다', async () => {
    const cases = [
      <Form method="post" reloadDocument key="a" />,
      <Form method="post" action="https://evil.test/x" key="b" />,
      <Form method="post" target="_blank" key="c" />,
      <Form method="post" onSubmit={(event) => event.preventDefault()} key="d" />,
    ];
    for (const ui of cases) {
      const submit = renderForm(<div data-testid="wrap">{ui}</div>);
      fireEvent.submit(screen.getByTestId('wrap').querySelector('form')!);
      expect(submit).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it('submit 실패는 콘솔에 남긴다', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const submit = vi.fn(() => Promise.reject(new Error('offline')));
    const actions = { navigate: vi.fn(), revalidate: vi.fn(), prefetch: vi.fn(), submit };
    render(
      <RouterActionsContext value={actions}>
        <Form method="post" data-testid="form" />
      </RouterActionsContext>,
    );
    fireEvent.submit(screen.getByTestId('form'));
    await vi.waitFor(() => expect(error).toHaveBeenCalled());
  });
});
