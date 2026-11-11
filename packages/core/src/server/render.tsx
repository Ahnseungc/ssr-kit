import type { ReactNode } from 'react';
import { preinit, preloadModule } from 'react-dom';

import { isReportable } from '../core/errors';
import type { SsrRequest } from '../core/types';
import type { ResolvedAssets, ServerBuild } from './build';
import type { ErrorPhase, RenderSink } from './sink';

export interface RenderOptions {
  request: SsrRequest;
  /** 렌더할 전체 트리 (<html> 포함). 외부 라우터가 만든 문서를 그대로 넘긴다 */
  app: ReactNode;
  /** 클라 readSsrData() 로 받을 값. 안의 Promise 는 스트리밍된다 */
  data?: unknown;
  /** 프리로드할 모듈 (매니페스트 키, root 기준 경로) */
  modules?: string[];
  status?: number;
  headers?: Headers;
  isBot?: boolean;
  renderTimeout?: number;
  nonce?: string;
  onError?: (error: unknown, info: { url: string; phase: ErrorPhase }) => void;
}

type RenderBuild = Pick<
  ServerBuild,
  'bootstrapModules' | 'resolveAssets' | 'dev' | 'fixStacktrace' | 'tailHtml'
>;

const DEFAULT_RENDER_TIMEOUT_MS = 10_000;

const Preload = ({ assets, children }: { assets: ResolvedAssets; children: ReactNode }) => {
  for (const href of assets.modules) preloadModule(href);
  for (const href of assets.styles) preinit(href, { as: 'style', precedence: 'default' });
  return children;
};

/** RT6 저수준 API: 매칭·로더 없이 렌더·에셋·직렬화만 쓴다 */
export const render = async (
  build: RenderBuild,
  options: RenderOptions,
  sink: RenderSink,
): Promise<void> => {
  const { request } = options;
  const assets = await build.resolveAssets(options.modules ?? []);
  const report = (phase: ErrorPhase, error: unknown) => {
    if (!isReportable(error)) return;
    if (error instanceof Error) build.fixStacktrace?.(error);
    if (options.onError) options.onError(error, { url: request.url.href, phase });
    else console.error(`[ssr-kit] ${phase} 에러 (${request.url.pathname})`, error);
  };

  await sink.renderTree(<Preload assets={assets}>{options.app}</Preload>, {
    method: request.method,
    status: options.status ?? 200,
    headers: options.headers ?? new Headers(),
    bootstrapModules: build.bootstrapModules,
    data: options.data ?? null,
    dev: build.dev,
    nonce: options.nonce,
    tailHtml: build.tailHtml?.(options.nonce),
    isBot: options.isBot ?? false,
    renderTimeout: options.renderTimeout ?? DEFAULT_RENDER_TIMEOUT_MS,
    report,
    onShellError: () => {
      sink.writeHead(500, new Headers({ 'content-type': 'text/plain; charset=utf-8' }));
      sink.end('Internal Server Error');
    },
  });
};
