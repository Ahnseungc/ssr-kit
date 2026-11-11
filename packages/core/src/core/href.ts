import type { Params } from './types';

/**
 * 사용자·생성 코드가 declaration merging 으로 라우트 패턴을 등록한다.
 * `declare module 'ssr-kit' { interface Register { routes: '/' | '/gold/:id' } }`
 * 등록하지 않으면 Href 는 string 이다.
 */
export interface Register {}

/** 등록된 라우트 패턴 유니온. 미등록이면 string */
export type RoutePattern = Register extends { routes: infer R extends string } ? R : string;

type SegmentHref<S extends string> = S extends ''
  ? ''
  : S extends '*' | `:${string}?`
    ? `/${string}` | ''
    : S extends `:${string}`
      ? `/${string}`
      : `/${S}`;

type JoinHref<P extends string> = P extends `${infer Head}/${infer Rest}`
  ? `${SegmentHref<Head>}${JoinHref<Rest>}`
  : SegmentHref<P>;

type EmptyToRoot<H extends string> = H extends '' ? '/' : H;

type WithSuffix<H extends string> = H | `${H}?${string}` | `${H}#${string}`;

/** 패턴 하나 → 그 패턴에 맞는 href 템플릿 리터럴 유니온 */
export type PatternHref<P extends string> = P extends string ? EmptyToRoot<JoinHref<P>> : never;

/** 패턴 유니온 → 허용 href. 쿼리·해시만 바꾸는 링크와 외부 URL 도 허용한다 */
export type HrefFor<Patterns extends string> = string extends Patterns
  ? string
  : | WithSuffix<PatternHref<Patterns>>
    | `?${string}`
    | `#${string}`
    | `${'http' | 'https'}://${string}`;

/** Link·navigate 가 받는 주소. Register 가 없으면 string */
export type Href = HrefFor<RoutePattern>;

type HrefArgs<P extends string> = {} extends Params<P> ? [params?: Params<P>] : [params: Params<P>];

const encodeSplat = (value: string) => value.split('/').map(encodeURIComponent).join('/');

const fillSegment = (
  segment: string,
  params: Record<string, string | undefined>,
  pattern: string,
): string | undefined => {
  if (segment === '*') {
    const value = params['*'];
    if (value === undefined) throw new Error(`href: missing '*' param (${pattern})`);
    return value === '' ? undefined : encodeSplat(value);
  }
  if (!segment.startsWith(':')) return segment;
  const optional = segment.endsWith('?');
  const name = optional ? segment.slice(1, -1) : segment.slice(1);
  const value = params[name];
  if (value !== undefined) return encodeURIComponent(value);
  if (optional) return undefined;
  throw new Error(`href: missing '${name}' param (${pattern})`);
};

/** `href('/gold/:id', { id: '1' })` → `'/gold/1'`. 값은 encodeURIComponent, 비운 옵셔널은 뺀다 */
export function href<P extends RoutePattern>(pattern: P, ...args: HrefArgs<P>): Href {
  const params = (args[0] ?? {}) as Record<string, string | undefined>;
  const parts: string[] = [];
  for (const segment of pattern.split('/')) {
    if (!segment) continue;
    const filled = fillSegment(segment, params, pattern);
    if (filled !== undefined) parts.push(filled);
  }
  return `/${parts.join('/')}` as Href;
}
