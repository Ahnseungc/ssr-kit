import { Writable } from 'node:stream';

import { toRouteError } from '../core/errors';
import { escapeForScript, serialize } from '../core/serialize';
import type { SsrPayload } from '../core/types';

/** 클라 모듈이 뜨기 전에 도착한 settle 스크립트는 큐에 쌓아 둔다 (client/deferred.ts 가 비운다) */
const QUEUE_BOOTSTRAP = 'window.__SSRKQ=[];window.__SSRKR=function(){__SSRKQ.push(arguments)};';

interface DeferredEntry {
  id: number;
  promise: Promise<unknown>;
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

const settle = async (promise: Promise<unknown>) => {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, value: error };
  }
};

/** 데이터 엔드포인트용: Promise 를 모두 기다린 뒤 settle 된 형태로 직렬화 */
export const serializeSettledPayload = async (payload: SsrPayload, dev: boolean) => {
  const settled = new Map<Promise<unknown>, { ok: boolean; value: unknown }>();
  const pending: Promise<void>[] = [];
  // 1차: Promise 수집 (중첩 Promise 는 settle 후 다시 돈다)
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

export interface DeferredWriterOptions {
  entries: DeferredEntry[];
  dev: boolean;
  nonce?: string;
  timeoutMs: number;
  onError: (error: unknown) => void;
}

/**
 * React 출력과 settle 스크립트를 섞어 target 으로 보낸다.
 * React 는 한 번의 flush 를 동기로 쓰고 끝에 destination.flush() 를 부른다.
 * flush 사이(=태그 경계)에서만 스크립트를 끼워 넣고, React 가 end 해도 남은 Promise 를 기다린다.
 */
export class DeferredWriter extends Writable {
  private midFlush = false;
  private readonly queue: string[] = [];
  private readonly done: Promise<unknown>;

  constructor(
    private readonly target: Writable,
    private readonly options: DeferredWriterOptions,
  ) {
    super();
    const timeout = new Promise<'timeout'>((resolve) => {
      setTimeout(() => resolve('timeout'), options.timeoutMs).unref?.();
    });
    this.done = Promise.all(
      options.entries.map(async ({ id, promise }) => {
        const result = await Promise.race([settle(promise), timeout]);
        const outcome =
          result === 'timeout'
            ? {
                ok: false,
                value: new Error(`스트리밍 데이터가 ${options.timeoutMs}ms 안에 끝나지 않았다`),
              }
            : result;
        if (!outcome.ok) options.onError(outcome.value);
        this.inject(id, outcome);
      }),
    );
  }

  /** React 가 flush 사이클을 마칠 때 호출 */
  flush() {
    this.midFlush = false;
    for (const chunk of this.queue.splice(0)) this.target.write(chunk);
  }

  private inject(id: number, outcome: { ok: boolean; value: unknown }) {
    const value = outcome.ok
      ? serialize(outcome.value)
      : serialize(toRouteError(outcome.value, this.options.dev));
    const nonce = this.options.nonce ? ` nonce="${escapeAttribute(this.options.nonce)}"` : '';
    const script = `<script${nonce}>__SSRKR(${id},${outcome.ok ? 1 : 0},${escapeForScript(value)})</script>`;
    if (this.midFlush) this.queue.push(script);
    else this.target.write(script);
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error) => void) {
    this.midFlush = true;
    this.target.write(chunk);
    callback();
  }

  override _final(callback: (error?: Error) => void) {
    this.done.then(() => {
      this.flush();
      this.target.end();
      callback();
    }, callback);
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void) {
    if (error) this.target.destroy(error);
    callback(error);
  }
}
