// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RouteError, RouteMatch, RouteModule } from '../src/core/types';
import { Root } from '../src/react/components';
import { type RouterState, RouterStateContext } from '../src/react/context';

const Document = ({ children }: { children: ReactNode }) => <div>{children}</div>;

const Boom = () => {
  throw new Error('secret detail');
};

const match = (id: string): RouteMatch => ({
  id,
  params: {},
  route: { id, module: () => Promise.reject(new Error('unused')) },
});

const stateOf = (modules: RouteModule[], { dev = false, key = 'k0' } = {}): RouterState => {
  const matches = modules.map((_, i) => match(`r${i}`));
  return {
    location: { pathname: '/', search: '', hash: '', key },
    matches,
    modules,
    payload: { routes: matches.map((m) => m.id), data: {}, status: 200 },
    navigation: { state: 'idle' },
    dev,
  };
};

const renderRoot = (state: RouterState) =>
  render(
    <RouterStateContext value={state}>
      <Root Document={Document} />
    </RouterStateContext>,
  );

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('기본 루트 에러 경계', () => {
  it('ErrorBoundary 가 하나도 없으면 렌더 에러를 Document 안의 기본 에러 화면으로 그린다', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderRoot(stateOf([{ default: Boom }]));

    expect(screen.getByRole('heading').textContent).toBe('500');
    // prod 에서는 내부 메시지를 숨긴다
    expect(screen.queryByText('secret detail')).toBeNull();
  });

  it('dev 에서는 에러 메시지를 보여 준다', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderRoot(stateOf([{ default: Boom }], { dev: true }));

    expect(screen.getByText('secret detail')).toBeTruthy();
  });

  it('라우트 ErrorBoundary 가 있으면 그쪽이 먼저 잡는다', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ErrorBoundary = ({ error }: { error: RouteError }) => <p>route boundary {error.status}</p>;
    renderRoot(stateOf([{ default: Boom, ErrorBoundary }]));

    expect(screen.getByText('route boundary 500')).toBeTruthy();
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('이동(location.key 변경)하면 에러 상태를 지우고 다시 그린다', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender } = renderRoot(stateOf([{ default: Boom }]));
    expect(screen.getByRole('heading').textContent).toBe('500');

    const Fine = () => <p>recovered</p>;
    rerender(
      <RouterStateContext value={stateOf([{ default: Fine }], { key: 'k1' })}>
        <Root Document={Document} />
      </RouterStateContext>,
    );
    expect(screen.getByText('recovered')).toBeTruthy();
  });
});
