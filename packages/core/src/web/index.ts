import { PassThrough, Readable } from 'node:stream';

import type { SsrRequest } from '../core/types';
import { type AdapterOptions, toHandleOptions } from '../server/adapter';
import { type HandleOptions, handleRequest } from '../server/request';
import { createNodeSink } from '../server/stream';

/**
 * `Request → Response` 어댑터. 렌더러는 Node 스트림을 쓰므로
 * Node·Bun·Deno(또는 node 호환 플래그가 있는 런타임)에서 동작한다.
 */
export type WebHandlerOptions = AdapterOptions<Request>;

const NULL_BODY_STATUS = new Set([101, 204, 205, 304]);

export const toWebSsrRequest = (request: Request): SsrRequest => ({
  url: new URL(request.url),
  method: request.method,
  headers: request.headers,
  raw: request,
});

/** 로더에서 원본 Request 가 필요할 때 */
export const getWebRequest = (request: SsrRequest): Request => request.raw as Request;

const createWebSink = (request: Request, respond: (response: Response) => void) => {
  const body = new PassThrough();
  const controller = new AbortController();
  request.signal.addEventListener('abort', () => controller.abort(), { once: true });
  const sink = createNodeSink({
    writeHead(status, headers) {
      const stream =
        NULL_BODY_STATUS.has(status) || request.method === 'HEAD'
          ? null
          : (Readable.toWeb(body) as ReadableStream<Uint8Array>);
      if (!stream) body.resume();
      respond(new Response(stream, { status, headers }));
    },
    stream: body,
    signal: controller.signal,
  });
  return { sink, body };
};

/** unmatched: 'next' 면 매치가 없을 때 null 을 돌려준다 (Hono 등 다음 핸들러로 넘길 때) */
export const createWebHandler =
  (options: WebHandlerOptions, unmatched: HandleOptions['unmatched'] = 'render') =>
  (request: Request): Promise<Response | null> =>
    new Promise((resolve, reject) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        resolve(unmatched === 'next' ? null : new Response('Method Not Allowed', { status: 405 }));
        return;
      }
      const { sink, body } = createWebSink(request, resolve);
      handleRequest(
        options.build,
        toWebSsrRequest(request),
        sink,
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
          // 응답을 이미 돌려줬으면 본문 스트림을 끊는다
          body.destroy(error instanceof Error ? error : undefined);
          reject(error);
        },
      );
    });
