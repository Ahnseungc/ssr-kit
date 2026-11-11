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

const DEV_PAYLOAD_WARN_BYTES = 100 * 1024;

/** 문서용: Promise 에 id 를 붙여 직렬화하고 부트스트랩 스크립트를 만든다 */
export const serializeDocumentPayload = (payload: unknown, dev = false) => {
  const entries: DeferredEntry[] = [];
  const json = serialize(payload, {
    onPromise: (promise) => {
      const id = entries.length;
      entries.push({ id, promise });
      return { id };
    },
  });
  if (dev && json.length > DEV_PAYLOAD_WARN_BYTES) {
    console.warn(
      `[ssr-kit] 문서에 실은 로더 데이터가 ${Math.round(json.length / 1024)}KB 다. 필요한 필드만 반환하는 걸 고려하자`,
    );
  }
  return { bootstrap: `window.__SSRK=${escapeForScript(json)};${QUEUE_BOOTSTRAP}`, entries };
};

export const settle = async (promise: Promise<unknown>): Promise<Outcome> => {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, value: error };
  }
};

/** timeout 이 먼저 오면 reject 로 본다 */
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

/** timeoutMs 가 지나거나 signal 이 abort 되면 'timeout' */
export const createTimeout = (timeoutMs: number, signal?: AbortSignal) =>
  new Promise<'timeout'>((resolve) => {
    setTimeout(() => resolve('timeout'), timeoutMs).unref?.();
    if (signal?.aborted) resolve('timeout');
    signal?.addEventListener('abort', () => resolve('timeout'), { once: true });
  });

export interface SettleScriptOptions {
  dev: boolean;
  nonce?: string;
  /** 값을 직렬화하지 못했을 때 (reject 로 바꿔 보낸다) */
  onError: (error: unknown) => void;
}

const encodeOutcome = (outcome: Outcome, options: SettleScriptOptions) => {
  if (!outcome.ok) return { ok: false, json: serialize(toRouteError(outcome.value, options.dev)) };
  try {
    return { ok: true, json: serialize(outcome.value) };
  } catch (error) {
    // 클래스 인스턴스·중첩 Promise 등. 응답을 끊지 않고 reject 로 보낸다
    options.onError(error);
    return { ok: false, json: serialize(toRouteError(error, options.dev)) };
  }
};

/** settle 결과를 클라 __SSRKR 호출 스크립트로 */
export const settleScript = (id: number, outcome: Outcome, options: SettleScriptOptions) => {
  const { ok, json } = encodeOutcome(outcome, options);
  const attribute = options.nonce ? ` nonce="${escapeAttribute(options.nonce)}"` : '';
  return `<script${attribute}>__SSRKR(${id},${ok ? 1 : 0},${escapeForScript(json)})</script>`;
};

export interface SettledPayloadOptions {
  dev: boolean;
  timeoutMs: number;
  signal: AbortSignal;
  onError: (error: unknown) => void;
}

/** 데이터 엔드포인트용: Promise 를 모두 기다린 뒤 settle 된 형태로 직렬화 (문서 경로와 같은 타임아웃) */
export const serializeSettledPayload = async (payload: unknown, options: SettledPayloadOptions) => {
  const settled = new Map<Promise<unknown>, Outcome>();
  const pending: Promise<void>[] = [];
  const timeout = createTimeout(options.timeoutMs, options.signal);
  const reject = (promise: Promise<unknown>, error: unknown) => {
    options.onError(error);
    settled.set(promise, { ok: false, value: toRouteError(error, options.dev) });
  };
  // Promise 수집 (중첩 Promise 는 settle 후 다시 돈다)
  const collect = (value: unknown) =>
    serialize(value, {
      onPromise: (promise) => {
        if (!settled.has(promise)) {
          settled.set(promise, { ok: true, value: undefined });
          pending.push(
            settleWithin(promise, timeout, options.timeoutMs).then((result) => {
              if (!result.ok) return reject(promise, result.value);
              try {
                collect(result.value);
                settled.set(promise, result);
              } catch (error) {
                reject(promise, error);
              }
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
