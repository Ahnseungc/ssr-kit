import type { RouteError } from './types';

type RedirectStatus = 301 | 302 | 303 | 307 | 308;

export class RedirectSignal {
  constructor(
    readonly to: string,
    readonly status: RedirectStatus,
  ) {}
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** httpError(status, message) 로 메시지를 명시했는지. 명시한 메시지는 prod 에서도 노출 */
    readonly explicit: boolean,
  ) {
    super(message);
  }
}

const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  500: 'Internal Server Error',
};

const DEFAULT_REDIRECT_STATUS = 302;
const INTERNAL_ERROR_STATUS = 500;

export const statusText = (status: number) => STATUS_TEXT[status] ?? 'Error';

export function redirect(to: string, status: RedirectStatus = DEFAULT_REDIRECT_STATUS): never {
  throw new RedirectSignal(to, status);
}

export function notFound(): never {
  throw new HttpError(404, statusText(404), false);
}

export function httpError(status: number, message?: string): never {
  throw new HttpError(status, message ?? statusText(status), message !== undefined);
}

export const isRedirect = (value: unknown): value is RedirectSignal =>
  value instanceof RedirectSignal;

export const toRouteError = (error: unknown, dev: boolean): RouteError => {
  if (error instanceof HttpError) {
    return {
      status: error.status,
      message: error.explicit || dev ? error.message : statusText(error.status),
      ...(dev && error.stack ? { stack: error.stack } : {}),
    };
  }
  const status = INTERNAL_ERROR_STATUS;
  if (!dev) return { status, message: statusText(status) };
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  return { status, message, ...(stack ? { stack } : {}) };
};

/** HttpError(4xx 등 의도된 응답)는 onError 로 보고하지 않는다 */
export const isReportable = (error: unknown) => !(error instanceof HttpError);
