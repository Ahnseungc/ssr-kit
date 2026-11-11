import type { Writable } from 'node:stream';

import type { ReactNode } from 'react';
import { renderToPipeableStream } from 'react-dom/server';

import { DeferredWriter } from './deferred';
import { serializeDocumentPayload } from './payload';
import { HTML_CONTENT_TYPE, type RenderSink, type TreeRenderOptions } from './sink';

export type { ErrorPhase, RenderSink, TreeRenderOptions } from './sink';

export interface NodeTarget {
  writeHead(status: number, headers: Headers): void;
  stream: Writable;
  signal: AbortSignal;
}

const streamTree = (target: NodeTarget, tree: ReactNode, options: TreeRenderOptions) =>
  new Promise<void>((resolve) => {
    const { headers } = options;
    headers.set('content-type', HTML_CONTENT_TYPE);
    if (options.method === 'HEAD') {
      target.writeHead(options.status, headers);
      target.stream.end();
      resolve();
      return;
    }

    const { bootstrap, entries } = serializeDocumentPayload(options.data, options.dev);
    const writer = new DeferredWriter(target.stream, {
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
      target.writeHead(options.status, headers);
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
        if (target.signal.aborted) return;
        options.report(started ? 'stream' : 'shell', error);
      },
    });

    const timer = setTimeout(
      () => stream.abort(new Error(`renderTimeout(${options.renderTimeout}ms) 초과`)),
      options.renderTimeout,
    );
    timer.unref?.();
    target.stream.on('close', () => clearTimeout(timer));
    // 로더를 도는 사이 이미 끊긴 연결이면 바로 중단
    if (target.signal.aborted) stream.abort();
    else target.signal.addEventListener('abort', () => stream.abort(), { once: true });
  });

/** Node Writable 로 응답하는 sink. renderToPipeableStream + flush 경계 데이터 삽입 */
export const createNodeSink = (target: NodeTarget): RenderSink => ({
  writeHead: (status, headers) => target.writeHead(status, headers),
  end: (body) => {
    if (body === undefined) target.stream.end();
    else target.stream.end(body);
  },
  signal: target.signal,
  renderTree: (tree, options) => streamTree(target, tree, options),
});
