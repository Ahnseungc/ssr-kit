import { Writable } from 'node:stream';

import {
  createTimeout,
  type DeferredEntry,
  type Outcome,
  settleScript,
  settleWithin,
} from './payload';

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
 * React 의 첫 flush 전에 settle 된 값(이미 resolve 된 Promise·봇 모드)은 첫 flush 뒤로 미룬다.
 */
export class DeferredWriter extends Writable {
  /** React 가 아직 아무것도 안 썼으면 문서 앞에 끼면 안 되므로 flush 중과 같게 본다 */
  private midFlush = true;
  private readonly queue: string[] = [];
  private readonly done: Promise<unknown>;

  constructor(
    private readonly target: Writable,
    private readonly options: DeferredWriterOptions,
  ) {
    super();
    const timeout = createTimeout(options.timeoutMs);
    this.done = Promise.all(
      options.entries.map(async ({ id, promise }) => {
        const outcome = await settleWithin(promise, timeout, options.timeoutMs);
        if (!outcome.ok) options.onError(outcome.value);
        this.inject(id, outcome);
      }),
    );
    // _final 전에 실패해도 unhandled rejection 이 되지 않게
    this.done.catch(() => {});
  }

  /** React 가 flush 사이클을 마칠 때 호출 */
  flush() {
    this.midFlush = false;
    for (const chunk of this.queue.splice(0)) this.target.write(chunk);
  }

  private inject(id: number, outcome: Outcome) {
    const script = settleScript(id, outcome, this.options);
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
