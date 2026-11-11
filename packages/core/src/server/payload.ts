import { toRouteError } from '../core/errors';
import { escapeForScript, serialize } from '../core/serialize';

/** 클라 모듈이 뜨기 전에 도착한 settle 스크립트는 큐에 쌓아 둔다 (client/deferred.ts 가 비운다) */
const QUEUE_BOOTSTRAP = 'window.__SSRKQ=[];window.__SSRKR=function(){__SSRKQ.push(arguments)};';

export interface DeferredEntry {
  id: number;
  promise: Promise<unknown>;
}

export interface Outcome {
  ok: boolean;
  value: unknown;
}

const escapeAttribute = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/** 문서용: Promise 에 id 를 붙여 직렬화하고 부트스트랩 스크립트를 만든다 */
export const serializeDocumentPayload = (payload: unknown) => {
  const entries: DeferredEntry[] = [];
  const json = serialize(payload, {
    onPromise: (promise) => {
      const id = entries.length;
      entries.push({ id, promise });
      return { id };
    },
  });
  return { bootstrap: `window.__SSRK=${escapeForScript(json)};${QUEUE_BOOTSTRAP}`, entries };
};

export const settle = async (promise: Promise<unknown>): Promise<Outcome> => {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, value: error };
  }
};

/** timeoutMs 안에 settle 안 되면 reject 로 본다 */
export const settleWithin = (
  promise: Promise<unknown>,
  timeout: Promise<'timeout'>,
  timeoutMs: number,
) =>
  Promise.race([settle(promise), timeout]).then((result): Outcome =>
    result === 'timeout'
      ? { ok: false, value: new Error(`스트리밍 데이터가 ${timeoutMs}ms 안에 끝나지 않았다`) }
      : result,
  );

export const createTimeout = (timeoutMs: number) =>
  new Promise<'timeout'>((resolve) => {
    setTimeout(() => resolve('timeout'), timeoutMs).unref?.();
  });

/** settle 결과를 클라 __SSRKR 호출 스크립트로 */
export const settleScript = (id: number, outcome: Outcome, dev: boolean, nonce?: string) => {
  const value = outcome.ok ? serialize(outcome.value) : serialize(toRouteError(outcome.value, dev));
  const attribute = nonce ? ` nonce="${escapeAttribute(nonce)}"` : '';
  return `<script${attribute}>__SSRKR(${id},${outcome.ok ? 1 : 0},${escapeForScript(value)})</script>`;
};

/** 데이터 엔드포인트용: Promise 를 모두 기다린 뒤 settle 된 형태로 직렬화 */
export const serializeSettledPayload = async (payload: unknown, dev: boolean) => {
  const settled = new Map<Promise<unknown>, Outcome>();
  const pending: Promise<void>[] = [];
  // Promise 수집 (중첩 Promise 는 settle 후 다시 돈다)
  const collect = (value: unknown) =>
    serialize(value, {
      onPromise: (promise) => {
        if (!settled.has(promise)) {
          settled.set(promise, { ok: true, value: undefined });
          pending.push(
            settle(promise).then((result) => {
              settled.set(promise, {
                ok: result.ok,
                value: result.ok ? result.value : toRouteError(result.value, dev),
              });
              if (result.ok) collect(result.value);
            }),
          );
        }
        return { ok: true, value: undefined };
      },
    });
  collect(payload);
  while (pending.length) await Promise.all(pending.splice(0));
  return serialize(payload, { onPromise: (promise) => settled.get(promise)! });
};
