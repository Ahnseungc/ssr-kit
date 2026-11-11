import type { ReactNode } from 'react';
import { renderToReadableStream } from 'react-dom/server';

import type { SsrRequest } from '../core/types';
import { type AdapterOptions, toHandleOptions } from '../server/adapter';
import {
  createTimeout,
  type DeferredEntry,
  serializeDocumentPayload,
  settleScript,
  settleWithin,
} from '../server/payload';
import { type HandleOptions, handleRequest } from '../server/request';
import { HTML_CONTENT_TYPE, type RenderSink, type TreeRenderOptions } from '../server/sink';

/**
 * Web 스트림 전용 어댑터 (Cloudflare Workers·Vercel Edge·Deno Deploy 등).
 * node:* 모듈을 쓰지 않는다. Promise 데이터의 settle 스크립트는
 * React 출력이 끝난 뒤(태그 경계가 보장되는 유일한 시점)에 이어 붙인다.
 */
export type EdgeHandlerOptions = AdapterOptions<Request>;

const NULL_BODY_STATUS = new Set([101, 204, 205, 304]);
const encoder = new TextEncoder();

const hasNoBody = (status: number, method: string) =>
  NULL_BODY_STATUS.has(status) || method === 'HEAD';

/** React 출력 끝에 settle 스크립트를 붙이는 TransformStream */
const appendDeferred = (entries: DeferredEntry[], options: TreeRenderOptions) => {
  const timeout = createTimeout(options.renderTimeout);
  const scriptOptions = {
    dev: options.dev,
    nonce: options.nonce,
    onError: (error: unknown) => options.report('stream', error),
  };
  const scripts = Promise.all(
    entries.map(async ({ id, promise }) => {
      const outcome = await settleWithin(promise, timeout, options.renderTimeout);
      if (!outcome.ok) options.report('stream', outcome.value);
      return settleScript(id, outcome, scriptOptions);
    }),
  );
  // flush 전에 실패해도 unhandled rejection 이 되지 않게
  scripts.catch(() => {});
  return new TransformStream<Uint8Array, Uint8Array>({
    async flush(controller) {
      for (const script of await scripts) controller.enqueue(encoder.encode(script));
    },
  });
};

const renderTree = async (
  respond: (response: Response) => void,
  signal: AbortSignal,
  tree: ReactNode,
  options: TreeRenderOptions,
) => {
  const { headers } = options;
  headers.set('content-type', HTML_CONTENT_TYPE);
  if (options.method === 'HEAD') {
    respond(new Response(null, { status: options.status, headers }));
    return;
  }

  const { bootstrap, entries } = serializeDocumentPayload(options.data, options.dev);
  const abort = new AbortController();
  const timer = setTimeout(
    () => abort.abort(new Error(`renderTimeout(${options.renderTimeout}ms) 초과`)),
    options.renderTimeout,
  );
  if (signal.aborted) abort.abort();
  else signal.addEventListener('abort', () => abort.abort(), { once: true });

  let started = false;
  let stream: Awaited<ReturnType<typeof renderToReadableStream>>;
  try {
    stream = await renderToReadableStream(tree, {
      bootstrapModules: options.bootstrapModules,
      bootstrapScriptContent: bootstrap,
      nonce: options.nonce,
      signal: abort.signal,
      onError(error) {
        if (signal.aborted) return;
        options.report(started ? 'stream' : 'shell', error);
      },
    });
  } catch (error) {
    clearTimeout(timer);
    await options.onShellError(error);
    return;
  }
  started = true;
  stream.allReady.then(
    () => clearTimeout(timer),
    () => clearTimeout(timer),
  );
  if (options.isBot) await stream.allReady.catch(() => {});
  respond(
    new Response(stream.pipeThrough(appendDeferred(entries, options)), {
      status: options.status,
      headers,
    }),
  );
};

export const createEdgeSink = (
  request: Request,
  respond: (response: Response) => void,
): RenderSink => {
  const controller = new AbortController();
  request.signal.addEventListener('abort', () => controller.abort(), { once: true });
  let head = { status: 200, headers: new Headers() };
  return {
    writeHead(status, headers) {
      head = { status, headers };
    },
    end(body) {
      const content = hasNoBody(head.status, request.method) ? null : (body ?? null);
      respond(new Response(content, head));
    },
    signal: controller.signal,
    renderTree: (tree, options) => renderTree(respond, controller.signal, tree, options),
  };
};

export const toEdgeSsrRequest = (request: Request): SsrRequest => ({
  url: new URL(request.url),
  method: request.method,
  headers: request.headers,
  raw: request,
  readBody: () => request.arrayBuffer(),
});

/** unmatched: 'next' 면 매치가 없을 때 null 을 돌려준다 */
export const createEdgeHandler =
  (options: EdgeHandlerOptions, unmatched: HandleOptions['unmatched'] = 'render') =>
  (request: Request): Promise<Response | null> =>
    new Promise((resolve, reject) => {
      handleRequest(
        options.build,
        toEdgeSsrRequest(request),
        createEdgeSink(request, resolve),
        toHandleOptions(
          options,
          request,
          request.headers.get('user-agent') ?? undefined,
          unmatched,
        ),
      ).then(
        (result) => {
          if (result === 'unmatched') resolve(null);
        },
        (error: unknown) => {
          if (error instanceof Error) options.build.fixStacktrace?.(error);
          reject(error);
        },
      );
    });
