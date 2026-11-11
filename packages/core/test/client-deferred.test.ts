// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { readSsrData } from '../src/client/deferred';
import { serialize } from '../src/core/serialize';

describe('클라 스트리밍 Promise 복원', () => {
  it('큐에 먼저 온 settle 과 나중에 온 settle 을 모두 반영한다', async () => {
    const early = Promise.resolve();
    const late = Promise.resolve();
    const ids = new Map<Promise<unknown>, number>([
      [early, 0],
      [late, 1],
    ]);
    window.__SSRK = JSON.parse(
      serialize({ a: early, b: late }, { onPromise: (p) => ({ id: ids.get(p)! }) }),
    );
    window.__SSRKQ = [[0, 1, JSON.parse(serialize({ at: new Date('2026-01-01T00:00:00Z') }))]];

    const data = readSsrData<{ a: Promise<{ at: Date }>; b: Promise<unknown> }>();
    await expect(data.a).resolves.toEqual({ at: new Date('2026-01-01T00:00:00Z') });

    window.__SSRKR!(1, 0, JSON.parse(serialize({ status: 503, message: '점검 중' })));
    await expect(data.b).rejects.toMatchObject({ status: 503, message: '점검 중' });
  });
});
