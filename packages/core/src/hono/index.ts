import type { Context, MiddlewareHandler } from 'hono';

import type { AdapterOptions } from '../node/index';
import { createWebHandler, type WebHandlerOptions } from '../web/index';

export type HonoSsrOptions = AdapterOptions<Context>;

/** 사용자 콜백은 Hono Context 를 받으므로 요청마다 Context 를 묶은 옵션을 만든다 */
const bindContext = (options: HonoSsrOptions, c: Context): WebHandlerOptions => {
  const { getContext, getNonce, isBot } = options;
  return {
    build: options.build,
    renderTimeout: options.renderTimeout,
    onError: options.onError,
    getContext: getContext && (() => getContext(c)),
    getNonce: getNonce && (() => getNonce(c)),
    isBot: typeof isBot === 'function' ? () => isBot(c) : isBot,
  };
};

/** `app.use('*', ssrKit({ build }))` — 매치가 없으면 다음 핸들러로 넘긴다 */
export const ssrKit =
  (options: HonoSsrOptions): MiddlewareHandler =>
  async (c, next) => {
    const response = await createWebHandler(bindContext(options, c), 'next')(c.req.raw);
    if (!response) return next();
    return response;
  };
