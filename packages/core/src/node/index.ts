import type { IncomingMessage, ServerResponse } from 'node:http';
import type { TLSSocket } from 'node:tls';

import type { SsrRequest } from '../core/types';
import { type AdapterOptions, toHandleOptions } from '../server/adapter';
import { handleRequest, type RenderSink } from '../server/request';
import { createNodeSink } from '../server/stream';

export type { AdapterOptions } from '../server/adapter';
export { toHandleOptions } from '../server/adapter';

export type NodeHandlerOptions = AdapterOptions<IncomingMessage>;

type Next = (error?: unknown) => void;

/** 앞선 미들웨어(body-parser 등)가 이미 읽었으면 빈 본문이 된다 */
const readNodeBody = async (req: IncomingMessage) => {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) chunks.push(chunk as Uint8Array);
  return Buffer.concat(chunks);
};

export const toSsrRequest = (req: IncomingMessage): SsrRequest => {
  const encrypted = (req.socket as TLSSocket).encrypted === true;
  const url = new URL(
    req.url ?? '/',
    `${encrypted ? 'https' : 'http'}://${req.headers.host ?? 'localhost'}`,
  );
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else headers.set(key, value);
  }
  return { url, method: req.method ?? 'GET', headers, raw: req, readBody: () => readNodeBody(req) };
};

/** 로더에서 Node 원본 요청(미들웨어가 붙인 필드 등)이 필요할 때 */
export const getNodeRequest = (request: SsrRequest): IncomingMessage =>
  request.raw as IncomingMessage;

export const createSink = (res: ServerResponse): RenderSink => {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });
  return createNodeSink({
    writeHead(status, headers) {
      res.statusCode = status;
      for (const [key, value] of headers) {
        if (key !== 'set-cookie') res.setHeader(key, value);
      }
      const cookies = headers.getSetCookie();
      if (cookies.length) res.setHeader('set-cookie', cookies);
    },
    stream: res,
    signal: controller.signal,
  });
};

export const fail = (res: ServerResponse, error: unknown, next?: Next) => {
  if (res.headersSent) {
    res.destroy(error instanceof Error ? error : undefined);
    return;
  }
  if (next) {
    next(error);
    return;
  }
  res.statusCode = 500;
  res.end('Internal Server Error');
};

export const createSsrHandler =
  (options: NodeHandlerOptions) =>
  async (req: IncomingMessage, res: ServerResponse, next?: Next): Promise<void> => {
    try {
      const result = await handleRequest(
        options.build,
        toSsrRequest(req),
        createSink(res),
        toHandleOptions(options, req, req.headers['user-agent'], next ? 'next' : 'render'),
      );
      if (result === 'unmatched') next?.();
    } catch (error) {
      if (error instanceof Error) options.build.fixStacktrace?.(error);
      if (!next) console.error('[ssr-kit] 요청 처리 실패', error);
      fail(res, error, next);
    }
  };
