import { describe, expect, expectTypeOf, it } from 'vitest';

import { href, type HrefFor, type PatternHref } from '../src/core/href';

type AppHref = HrefFor<'/' | '/gold/:id' | '/:lang?/about' | '/files/*' | '/a/:b?/:c?'>;

/** 50개 + 옵셔널 조합. 유니온 폭발·재귀 한도에 걸리지 않아야 한다 */
type ManyPatterns =
  | `/static-${'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j'}`
  | `/items-${'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j'}/:id`
  | `/:lang?/docs-${'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j'}/:page?`
  | `/shop-${'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j'}/:cat/:sub?/*`
  | `/deep-${'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j'}/:a?/:b?/:c?/end`;
type ManyHref = HrefFor<ManyPatterns>;

describe('href()', () => {
  it('파라미터를 채우고 encodeURIComponent 한다', () => {
    expect(href('/gold/:id', { id: '1' })).toBe('/gold/1');
    expect(href('/gold/:id', { id: 'a b/c?' })).toBe('/gold/a%20b%2Fc%3F');
    expect(href('/')).toBe('/');
    expect(href('/about')).toBe('/about');
  });

  it('비운 옵셔널은 세그먼트째 뺀다', () => {
    expect(href('/:lang?/about', {})).toBe('/about');
    expect(href('/:lang?/about', { lang: 'ko' })).toBe('/ko/about');
    expect(href('/a/:b?/:c?', { c: 'x' })).toBe('/a/x');
  });

  it('* 는 / 를 살리고 세그먼트마다 인코딩한다', () => {
    expect(href('/files/*', { '*': 'a b/c%d' })).toBe('/files/a%20b/c%25d');
    expect(href('/files/*', { '*': '' })).toBe('/files');
  });

  it('필수 파라미터가 없으면 던진다', () => {
    expect(() => href('/gold/:id', {} as { id: string })).toThrow(/'id'/);
    expect(() => href('/files/*', {} as { '*': string })).toThrow(/'\*'/);
  });

  it('미등록이면 아무 패턴·string 파라미터를 받는다', () => {
    expectTypeOf(href).parameter(0).toEqualTypeOf<string>();
    expect(href('/x/:y', { y: '1' })).toBe('/x/1');
  });
});

describe('Href 타입', () => {
  it('패턴별 템플릿 리터럴', () => {
    expectTypeOf<PatternHref<'/'>>().toEqualTypeOf<'/'>();
    expectTypeOf<PatternHref<'/gold/:id'>>().toEqualTypeOf<`/gold/${string}`>();
    expectTypeOf<PatternHref<'/:lang?/about'>>().toEqualTypeOf<'/about' | `/${string}/about`>();
    expectTypeOf<PatternHref<'/files/*'>>().toEqualTypeOf<'/files' | `/files/${string}`>();
  });

  it('미등록(string)이면 string', () => {
    expectTypeOf<HrefFor<string>>().toEqualTypeOf<string>();
  });

  it('맞는 주소는 통과, 오타는 컴파일 에러', () => {
    const ok: AppHref[] = [
      '/',
      '/gold/1',
      '/gold/1?tab=a#x',
      '/?q=1',
      '/about',
      '/ko/about',
      '/files',
      '/files/a/b',
      '/a',
      '/a/1/2',
      '#top',
      '?page=2',
      'https://example.com',
    ];
    expect(ok).toHaveLength(13);
    // @ts-expect-error 경로 오타
    const typo: AppHref = '/gol/1';
    // @ts-expect-error 정적 경로 뒤 임의 세그먼트
    const extra: AppHref = '/about/x';
    // @ts-expect-error 상대 경로
    const relative: AppHref = 'gold/1';
    expect([typo, extra, relative]).toHaveLength(3);
  });

  it('50개 패턴 + 옵셔널 조합도 검사한다', () => {
    const ok: ManyHref[] = [
      '/static-a',
      '/items-j/1',
      '/docs-c',
      '/en/docs-c/2',
      '/shop-b/x/y/z',
      '/deep-a/end',
      '/deep-a/1/2/3/end',
    ];
    expect(ok).toHaveLength(7);
    // @ts-expect-error 없는 경로
    const bad: ManyHref = '/static-z';
    expect(bad).toBe('/static-z');
  });

  it('href() 는 패턴의 Params 를 요구한다', () => {
    expectTypeOf(href<'/gold/:id'>)
      .parameter(1)
      .toEqualTypeOf<{ id: string }>();
    // @ts-expect-error id 누락
    expect(() => href('/gold/:id', {})).toThrow();
    // @ts-expect-error 파라미터 객체 자체가 없다
    expect(() => href('/gold/:id')).toThrow();
  });
});
