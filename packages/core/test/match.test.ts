import { describe, expect, expectTypeOf, it } from 'vitest';

import { createMatcher, InvalidPathError } from '../src/core/match';
import type { Params, RouteDef } from '../src/core/types';

const mod = () => Promise.resolve({ default: () => null });

const routes: RouteDef[] = [
  {
    id: 'root',
    module: mod,
    children: [
      { id: 'home', path: '/', module: mod },
      { id: 'gold-new', path: 'gold/new', module: mod },
      { id: 'gold', path: 'gold/:id', module: mod },
      { id: 'about', path: ':lang?/about', module: mod },
      { id: 'files', path: 'files/*', module: mod },
      {
        id: 'admin',
        path: 'admin',
        module: mod,
        children: [
          { id: 'admin-index', module: mod },
          { id: 'admin-user', path: 'users/:uid', module: mod },
        ],
      },
    ],
  },
];

const ids = (pathname: string) => createMatcher(routes)(pathname)?.map((m) => m.id) ?? null;

describe('createMatcher', () => {
  it('pathless 레이아웃을 포함한 루트→리프 체인을 돌려준다', () => {
    expect(ids('/')).toEqual(['root', 'home']);
    expect(ids('/admin')).toEqual(['root', 'admin', 'admin-index']);
    expect(ids('/admin/users/7')).toEqual(['root', 'admin', 'admin-user']);
  });

  it('정적 세그먼트가 동적보다 우선한다', () => {
    expect(ids('/gold/new')).toEqual(['root', 'gold-new']);
    expect(ids('/gold/42')).toEqual(['root', 'gold']);
  });

  it('우선순위: 인덱스가 catch-all 보다, 정적이 옵셔널 패턴보다 앞선다', () => {
    const match = (list: RouteDef[], path: string) => createMatcher(list)(path)?.at(-1)?.id;
    const indexAndAll: RouteDef[] = [
      { id: 'all', path: '*', module: mod },
      { id: 'idx', path: '/', module: mod },
    ];
    expect(match(indexAndAll, '/')).toBe('idx');
    expect(match(indexAndAll, '/x/y')).toBe('all');
    expect(
      match(
        [
          {
            module: mod,
            children: [
              { id: 'idx', path: '/', module: mod },
              { id: 'all', path: '*', module: mod },
            ],
          },
        ],
        '/',
      ),
    ).toBe('idx');
    const docs: RouteDef[] = [
      { id: 'i18n', path: '/:lang?/docs', module: mod },
      { id: 'docs', path: '/docs', module: mod },
    ];
    expect(match(docs, '/docs')).toBe('docs');
    expect(match(docs, '/en/docs')).toBe('i18n');
    expect(
      match(
        [
          { id: 'a', path: ':x', module: mod },
          { id: 'b', path: ':y', module: mod },
        ],
        '/z',
      ),
    ).toBe('a');
  });

  it('동적·옵셔널·와일드카드 params 를 채운다', () => {
    const match = createMatcher(routes);
    expect(match('/gold/42')?.at(-1)?.params).toEqual({ id: '42' });
    expect(match('/en/about')?.at(-1)?.params).toEqual({ lang: 'en' });
    expect(match('/about')?.at(-1)?.params).toEqual({});
    expect(match('/files/a/b.txt')?.at(-1)?.params).toEqual({ '*': 'a/b.txt' });
  });

  it('끝 슬래시를 무시하고 퍼센트 인코딩을 푼다', () => {
    expect(ids('/gold/42/')).toEqual(['root', 'gold']);
    expect(createMatcher(routes)('/gold/%EA%B8%88')?.at(-1)?.params).toEqual({ id: '금' });
  });

  it('매치가 없으면 null', () => {
    expect(ids('/nope/nope')).toBeNull();
  });

  it('잘못된 인코딩은 InvalidPathError', () => {
    expect(() => createMatcher(routes)('/gold/%E0%A4%A')).toThrow(InvalidPathError);
  });

  it('id 를 생략하면 부모 id + 인덱스로 만든다', () => {
    const match = createMatcher([{ module: mod, children: [{ path: 'a', module: mod }] }]);
    expect(match('/a')?.map((m) => m.id)).toEqual(['0', '0-0']);
  });

  it('id 중복과 중간 * 는 에러', () => {
    expect(() =>
      createMatcher([
        { id: 'x', path: 'a', module: mod },
        { id: 'x', path: 'b', module: mod },
      ]),
    ).toThrow(/중복/);
    expect(() => createMatcher([{ path: 'a/*/b', module: mod }])).toThrow();
  });
});

describe('Params 타입', () => {
  it('경로 문자열에서 params 를 추론한다', () => {
    expectTypeOf<Params<'/gold/:id/:tab?'>>().toEqualTypeOf<{ id: string; tab?: string }>();
    expectTypeOf<Params<'/files/*'>>().toEqualTypeOf<{ '*': string }>();
  });
});
