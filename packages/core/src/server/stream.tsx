import type { Writable } from 'node:stream';

import type { ReactNode } from 'react';
import { renderToPipeableStream } from 'react-dom/server';

import type { SsrRequest } from '../core/types';
import { DeferredWriter, serializeDocumentPayload } from './deferred';

export type ErrorPhase = 'loader' | 'shell' | 'stream' | 'data';

export interface RenderSink {
  /** 상태·헤더 확정 후 한 번 호출 */
  writeHead(status: number, headers: Headers): void;
  stream: Writable;
  /** 연결 종료 감지 */
  signal: AbortSignal;
}

export interface StreamTreeOptions {
  request: SsrRequest;
  sink: RenderSink;
  status: number;
  headers: Headers;
  bootstrapModules: string[];
  /** window.__SSRK 로 보낼 값. 안의 Promise 는 스트리밍된다 */
  data: unknown;
  dev: boolean;
  nonce?: string;
  /** true 면 Suspense 까지 모두 끝난 뒤 보낸다 */
  isBot: boolean;
  renderTimeout: number;
  report: (phase: ErrorPhase, error: unknown) => void;
  /** 셸 렌더 실패. 대체 응답을 쓰고 끝나면 resolve */
  onShellError: (error: unknown) => Promise<void> | void;
}

const HTML_CONTENT_TYPE = 'text/html; charset=utf-8';

/** React 트리를 sink 로 스트리밍한다. 셸이 나가면(또는 대체 응답이 끝나면) resolve */
export const streamTree = (tree: ReactNode, options: StreamTreeOptions): Promise<void> =>
  new Promise((resolve) => {
    const { sink, headers } = options;
    headers.set('content-type', HTML_CONTENT_TYPE);
    if (options.request.method === 'HEAD') {
      sink.writeHead(options.status, headers);
      sink.stream.end();
      resolve();
      return;
    }

    const { bootstrap, entries } = serializeDocumentPayload(options.data);
    const writer = new DeferredWriter(sink.stream, {
      entries,
      dev: options.dev,
      nonce: options.nonce,
      timeoutMs: options.renderTimeout,
      onError: (error) => options.report('stream', error),
    });

    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      sink.writeHead(options.status, headers);
      stream.pipe(writer);
      resolve();
    };

    const stream = renderToPipeableStream(tree, {
      bootstrapModules: options.bootstrapModules,
      bootstrapScriptContent: bootstrap,
      nonce: options.nonce,
      onShellReady() {
        if (!options.isBot) start();
      },
      onAllReady() {
        start();
      },
      onShellError(error) {
        Promise.resolve(options.onShellError(error)).then(resolve, resolve);
      },
      onError(error) {
        if (sink.signal.aborted) return;
        options.report(started ? 'stream' : 'shell', error);
      },
    });

    const timer = setTimeout(
      () => stream.abort(new Error(`renderTimeout(${options.renderTimeout}ms) 초과`)),
      options.renderTimeout,
    );
    timer.unref?.();
    sink.stream.on('close', () => clearTimeout(timer));
    sink.signal.addEventListener('abort', () => stream.abort(), { once: true });
  });
