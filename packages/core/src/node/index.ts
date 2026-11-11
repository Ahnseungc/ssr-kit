import type { IncomingMessage, ServerResponse } from 'node:http';
import type { TLSSocket } from 'node:tls';

import type { AppContext, SsrRequest } from '../core/types';
import type { ServerBuild } from '../server/build';
import {
  type ErrorPhase,
  type HandleOptions,
  handleRequest,
  type RenderSink,
} from '../server/request';

/** 어댑터 공통 옵션. Req 는 어댑터 원본 요청 */
export interface AdapterOptions<Req> {
  /** prod: `dist/server/entry.js` 의 build, dev: `await dev.getBuild()` */
  build: ServerBuild;
  getContext?: (req: Req) => AppContext | Promise<AppContext>;
  /** 기본: 검색엔진·SNS 미리보기 UA. false 면 항상 스트리밍 */
  isBot?: ((req: Req) => boolean) | false;
  /** ms */
  renderTimeout?: number;
  getNonce?: (req: Req) => string | undefined;
  onError?: (error: unknown, info: { url: string; phase: ErrorPhase }) => void;
}

export type NodeHandlerOptions = AdapterOptions<IncomingMessage>;

type Next = (error?: unknown) => void;

const DEFAULT_RENDER_TIMEOUT_MS = 10_000;
const BOT_UA =
  /bot|crawl|spider|slurp|facebookexternalhit|kakaotalk-scrap|daum|yeti|twitterbot|slackbot|linkedinbot|discordbot|whatsapp|telegrambot|applebot|bingpreview|googlebot|naver/i;

/** 어댑터 옵션 → handleRequest 옵션. userAgent 는 기본 봇 판별용 */
export const toHandleOptions = <Req>(
  options: AdapterOptions<Req>,
  req: Req,
  userAgent: string | undefined,
  unmatched: HandleOptions['unmatched'],
): HandleOptions => {
  const { getContext, isBot } = options;
  const detectBot = isBot === false ? () => false : (isBot ?? (() => BOT_UA.test(userAgent ?? '')));
  return {
    getContext: getContext ? () => getContext(req) : undefined,
    isBot: detectBot(req),
    renderTimeout: options.renderTimeout ?? DEFAULT_RENDER_TIMEOUT_MS,
    nonce: options.getNonce?.(req),
    onError: options.onError,
    unmatched,
  };
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
  return { url, method: req.method ?? 'GET', headers, raw: req };
};

/** 로더에서 Node 원본 요청(미들웨어가 붙인 필드 등)이 필요할 때 */
export const getNodeRequest = (request: SsrRequest): IncomingMessage =>
  request.raw as IncomingMessage;

export const createSink = (res: ServerResponse): RenderSink => {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });
  return {
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
  };
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
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (next) return next();
      res.statusCode = 405;
      res.end('Method Not Allowed');
      return;
    }
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
