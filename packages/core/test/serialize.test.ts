import { describe, expect, it } from 'vitest';

import { deserialize, escapeForScript, serialize, SerializeError } from '../src/core/serialize';

const roundTrip = <T>(value: T): T => deserialize<T>(serialize(value));

describe('serialize', () => {
  it('JSON 기본형과 특수 숫자를 왕복한다', () => {
    const value = {
      s: 'a',
      n: 1.5,
      b: true,
      z: null,
      u: undefined,
      nan: NaN,
      inf: Infinity,
      ninf: -Infinity,
    };
    const out = roundTrip(value);
    expect(out).toEqual(value);
    expect('u' in out).toBe(true);
    expect(Object.is(roundTrip(-0), -0)).toBe(true);
  });

  it('Date·Map·Set·BigInt·RegExp·URL 을 복원한다', () => {
    const value = {
      date: new Date('2026-11-11T00:00:00.000Z'),
      map: new Map<unknown, unknown>([
        ['a', 1],
        [2, { b: 3 }],
      ]),
      set: new Set([1, 'x']),
      big: 12345678901234567890n,
      re: /ab+c/gi,
      url: new URL('https://example.com/a?b=1'),
    };
    const out = roundTrip(value);
    expect(out.date).toBeInstanceOf(Date);
    expect(out.date.getTime()).toBe(value.date.getTime());
    expect(out.map).toEqual(value.map);
    expect(out.set).toEqual(value.set);
    expect(out.big).toBe(value.big);
    expect(out.re.source).toBe('ab+c');
    expect(out.re.flags).toBe('gi');
    expect(out.url.href).toBe(value.url.href);
  });

  it('배열(빈 배열·중첩)과 문자열로 시작하는 배열을 구분한다', () => {
    expect(roundTrip([])).toEqual([]);
    expect(roundTrip(['D', 'x'])).toEqual(['D', 'x']);
    expect(roundTrip([[1, [2]], { a: [] }])).toEqual([[1, [2]], { a: [] }]);
  });

  it('공유·순환 참조를 유지한다', () => {
    const shared = { v: 1 };
    const value: Record<string, unknown> = { a: shared, b: shared };
    value.self = value;
    const out = roundTrip(value);
    expect(out.a).toBe(out.b);
    expect(out.self).toBe(out);
  });

  it('함수·Symbol·클래스 인스턴스·Promise 는 경로와 함께 throw', () => {
    expect(() => serialize({ a: { fn: () => 1 } })).toThrow(/\$\.a\.fn/);
    expect(() => serialize({ s: Symbol('x') })).toThrow(SerializeError);
    class Gold {}
    expect(() => serialize([new Gold()])).toThrow(/Gold/);
    expect(() => serialize({ p: Promise.resolve(1) })).toThrow(/Promise/);
  });

  it('Object.create(null) 객체는 일반 객체로 취급한다', () => {
    const value = Object.assign(Object.create(null), { a: 1 });
    expect(roundTrip(value)).toEqual({ a: 1 });
  });
});

describe('escapeForScript', () => {
  it('</script> 와 줄 구분 문자를 이스케이프한다', () => {
    const json = serialize({ html: '</script><script>alert(1)</script>', ls: '\u2028\u2029' });
    const escaped = escapeForScript(json);
    expect(escaped).not.toContain('<');
    expect(escaped).not.toMatch(/[\u2028\u2029]/);
    expect(deserialize(JSON.parse(escaped))).toEqual({
      html: '</script><script>alert(1)</script>',
      ls: '\u2028\u2029',
    });
  });
});
