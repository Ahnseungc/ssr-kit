import { deserialize, toRejection } from '../core/serialize';

type Settle = (id: number, ok: 0 | 1, value: unknown[]) => void;

declare global {
  interface Window {
    __SSRK?: unknown[];
    /** 클라 모듈 로드 전에 도착한 settle 호출 */
    __SSRKQ?: ArrayLike<unknown>[];
    __SSRKR?: Settle;
  }
}

interface Deferred {
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

const deferreds = new Map<number, Deferred>();

const getDeferred = (id: number): Deferred => {
  let deferred = deferreds.get(id);
  if (!deferred) {
    let resolve!: Deferred['resolve'];
    let reject!: Deferred['reject'];
    const promise = new Promise<unknown>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // use() 하기 전 reject 가 unhandled rejection 으로 잡히지 않게
    promise.catch(() => {});
    deferred = { promise, resolve, reject };
    deferreds.set(id, deferred);
  }
  return deferred;
};

const settle: Settle = (id, ok, value) => {
  const deferred = getDeferred(id);
  const decoded = deserialize(value);
  if (ok === 1) deferred.resolve(decoded);
  else deferred.reject(toRejection(decoded));
};

/** window.__SSRK 를 읽고, 스트리밍 Promise 의 settle 스크립트를 연결한다 */
export const readSsrData = <T>(): T => {
  if (!window.__SSRK) throw new Error('ssr-kit server data (window.__SSRK) is missing');
  const data = deserialize<T>(window.__SSRK, { promise: (id) => getDeferred(id).promise });
  for (const args of window.__SSRKQ ?? []) {
    settle(args[0] as number, args[1] as 0 | 1, args[2] as unknown[]);
  }
  window.__SSRKQ = [];
  window.__SSRKR = settle;
  return data;
};
