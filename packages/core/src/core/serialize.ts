/**
 * 값 테이블 평탄화 직렬화. 0 번 칸이 루트.
 * - 원시값: 그대로 (문자열·유한 숫자·불리언·null)
 * - 배열: 원소 인덱스 배열 (첫 칸이 숫자이거나 빈 배열)
 * - 태그 값: [태그 문자열, ...] (첫 칸이 문자열)
 * - 객체: { 키: 인덱스 }
 * - 특수 값: 음수 인덱스
 * - Promise: ['P', id] (나중에 스트리밍) 또는 ['p', 1|0, 값] (이미 settle)
 */
const UNDEFINED = -1;
const NAN = -2;
const POSITIVE_INFINITY = -3;
const NEGATIVE_INFINITY = -4;
const NEGATIVE_ZERO = -5;

type Entry = unknown;

export class SerializeError extends Error {
  constructor(path: string, reason: string) {
    super(`직렬화할 수 없는 값 (${path}): ${reason}`);
  }
}

/** `__proto__` 같은 키도 프로토타입을 건드리지 않고 자기 속성으로 둔다 */
const setOwn = (target: Record<string, unknown>, key: string, value: unknown) => {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
};

/** React use() 가 이미 settle 된 것으로 보고 suspend 하지 않게 thenable 상태를 단다 */
const settledThenable = <T>(promise: Promise<T>, ok: boolean, value: unknown) =>
  Object.assign(
    promise,
    ok ? { status: 'fulfilled', value } : { status: 'rejected', reason: value },
  );

const isPlainObject = (value: object) => {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const specialNumber = (value: number) => {
  if (Number.isNaN(value)) return NAN;
  if (value === Infinity) return POSITIVE_INFINITY;
  if (value === -Infinity) return NEGATIVE_INFINITY;
  if (Object.is(value, -0)) return NEGATIVE_ZERO;
  return null;
};

/** Promise 를 만났을 때 처리 방식. 없으면 throw */
export type PromiseEncoder = (
  promise: Promise<unknown>,
) => { id: number } | { ok: boolean; value: unknown };

export interface SerializeOptions {
  onPromise?: PromiseEncoder;
}

export const serialize = (root: unknown, options: SerializeOptions = {}): string => {
  const table: Entry[] = [];
  const seen = new Map<unknown, number>();

  const add = (value: unknown, path: string): number => {
    if (value === undefined) return UNDEFINED;
    if (typeof value === 'number') {
      const special = specialNumber(value);
      if (special !== null) return special;
    }
    if (seen.has(value)) return seen.get(value)!;

    const index = table.length;
    table.push(null);
    if (typeof value === 'object' && value !== null) seen.set(value, index);
    table[index] = encode(value, path);
    return index;
  };

  const encode = (value: unknown, path: string): Entry => {
    switch (typeof value) {
      case 'string':
      case 'number':
      case 'boolean':
        return value;
      case 'bigint':
        return ['B', value.toString()];
      case 'function':
      case 'symbol':
        throw new SerializeError(path, typeof value);
    }
    if (value === null) return null;

    const object = value as object;
    if (Array.isArray(object)) {
      return object.length === 0 ? [] : object.map((item, i) => add(item, `${path}[${i}]`));
    }
    if (object instanceof Date) return ['D', object.toISOString()];
    if (object instanceof RegExp) return ['R', object.source, object.flags];
    if (object instanceof URL) return ['U', object.href];
    if (object instanceof Map) {
      const out: Entry[] = ['M'];
      let i = 0;
      for (const [k, v] of object) {
        out.push(add(k, `${path}<key ${i}>`), add(v, `${path}<value ${i}>`));
        i += 1;
      }
      return out;
    }
    if (object instanceof Set) {
      return ['S', ...[...object].map((item, i) => add(item, `${path}<${i}>`))];
    }
    if (object instanceof Promise) {
      if (!options.onPromise)
        throw new SerializeError(path, 'Promise 는 로더 데이터에서만 쓸 수 있다');
      const encoded = options.onPromise(object);
      if ('id' in encoded) return ['P', encoded.id];
      return ['p', encoded.ok ? 1 : 0, add(encoded.value, `${path}<settled>`)];
    }
    if (!isPlainObject(object)) {
      throw new SerializeError(path, `클래스 인스턴스 ${object.constructor?.name ?? ''}`);
    }

    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(object)) setOwn(out, k, add(v, `${path}.${k}`));
    return out;
  };

  const rootIndex = add(root, '$');
  // 루트가 특수 값이면 0 번 칸이 비므로 참조 태그로 채운다
  if (rootIndex < 0) table.push(['X', rootIndex]);
  return JSON.stringify(table);
};

/** HTML <script> 안에 넣을 수 있게 이스케이프 */
export const escapeForScript = (json: string) =>
  json
    .replace(/</g, '\\u003C')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

export interface DeserializeOptions {
  /** ['P', id] 자리에 넣을 Promise */
  promise?: (id: number) => Promise<unknown>;
}

/** 서버에서 reject 된 값(RouteError 모양)을 Error 로 */
export const toRejection = (value: unknown) => {
  const error = value as { status?: number; message?: string } | null;
  return Object.assign(new Error(error?.message ?? 'Error'), { status: error?.status ?? 500 });
};

const rejected = (reason: unknown) => {
  const error = toRejection(reason);
  const promise = Promise.reject(error);
  // 컴포넌트가 use() 하기 전까지 unhandled rejection 으로 잡히지 않게
  promise.catch(() => {});
  return settledThenable(promise, false, error);
};

export const deserialize = <T = unknown>(
  input: string | unknown[],
  options: DeserializeOptions = {},
): T => {
  const table = (typeof input === 'string' ? JSON.parse(input) : input) as Entry[];
  const done = new Map<number, unknown>();

  const read = (index: number): unknown => {
    switch (index) {
      case UNDEFINED:
        return undefined;
      case NAN:
        return NaN;
      case POSITIVE_INFINITY:
        return Infinity;
      case NEGATIVE_INFINITY:
        return -Infinity;
      case NEGATIVE_ZERO:
        return -0;
    }
    if (done.has(index)) return done.get(index);
    const entry = table[index];
    if (typeof entry !== 'object' || entry === null) {
      done.set(index, entry);
      return entry;
    }
    if (Array.isArray(entry)) return readArray(index, entry);

    const out: Record<string, unknown> = {};
    done.set(index, out);
    for (const [k, v] of Object.entries(entry as Record<string, number>)) setOwn(out, k, read(v));
    return out;
  };

  const readArray = (index: number, entry: Entry[]): unknown => {
    if (typeof entry[0] !== 'string') {
      const out: unknown[] = [];
      done.set(index, out);
      for (const item of entry as number[]) out.push(read(item));
      return out;
    }
    const [tag, ...rest] = entry as [string, ...unknown[]];
    switch (tag) {
      case 'X':
        return read(rest[0] as number);
      case 'P': {
        if (!options.promise) throw new Error('스트리밍 Promise 를 복원할 수 없다');
        return remember(index, options.promise(rest[0] as number));
      }
      case 'p': {
        const value = read(rest[1] as number);
        return remember(
          index,
          rest[0] === 1 ? settledThenable(Promise.resolve(value), true, value) : rejected(value),
        );
      }
      case 'D':
        return remember(index, new Date(rest[0] as string));
      case 'R':
        return remember(index, new RegExp(rest[0] as string, rest[1] as string));
      case 'U':
        return remember(index, new URL(rest[0] as string));
      case 'B':
        return remember(index, BigInt(rest[0] as string));
      case 'S': {
        const out = remember(index, new Set<unknown>());
        for (const item of rest as number[]) out.add(read(item));
        return out;
      }
      case 'M': {
        const out = remember(index, new Map<unknown, unknown>());
        const pairs = rest as number[];
        for (let i = 0; i < pairs.length; i += 2) out.set(read(pairs[i]!), read(pairs[i + 1]!));
        return out;
      }
    }
    throw new Error(`알 수 없는 직렬화 태그: ${tag}`);
  };

  const remember = <V>(index: number, value: V): V => {
    done.set(index, value);
    return value;
  };

  return read(0) as T;
};
