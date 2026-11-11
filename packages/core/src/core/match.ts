import type { RouteDef, RouteMatch } from './types';

type Segment =
  | { kind: 'static'; value: string }
  | { kind: 'param'; name: string }
  | { kind: 'optional'; name: string }
  | { kind: 'splat' };

interface Branch {
  chain: { id: string; route: RouteDef }[];
  segments: Segment[];
}

export class InvalidPathError extends Error {
  constructor(pathname: string) {
    super(`잘못된 경로 인코딩: ${pathname}`);
  }
}

const splitPath = (path: string) => path.split('/').filter(Boolean);

const parseSegment = (raw: string, fullPath: string): Segment => {
  if (raw === '*') return { kind: 'splat' };
  if (raw.startsWith(':')) {
    return raw.endsWith('?')
      ? { kind: 'optional', name: raw.slice(1, -1) }
      : { kind: 'param', name: raw.slice(1) };
  }
  if (raw.includes('*')) throw new Error(`'*' 는 단독 세그먼트로만 쓸 수 있다: ${fullPath}`);
  return { kind: 'static', value: raw };
};

/** 자식 path 를 부모 기준으로 잇는다 (§4.1). `/` 로 시작하면 절대 경로 */
export const joinPath = (parent: string, path: string | undefined) => {
  if (path === undefined) return parent;
  if (path.startsWith('/')) return path;
  return `${parent.replace(/\/$/, '')}/${path}`;
};

const flatten = (routes: RouteDef[]): Branch[] => {
  const branches: Branch[] = [];
  const ids = new Set<string>();

  const visit = (
    list: RouteDef[],
    parentPath: string,
    parentId: string | null,
    chain: Branch['chain'],
  ) => {
    list.forEach((route, index) => {
      const id = route.id ?? (parentId === null ? `${index}` : `${parentId}-${index}`);
      if (ids.has(id)) throw new Error(`라우트 id 중복: ${id}`);
      ids.add(id);

      const fullPath = joinPath(parentPath, route.path);
      const nextChain = [...chain, { id, route }];
      if (route.children?.length) {
        visit(route.children, fullPath, id, nextChain);
        return;
      }

      const raw = splitPath(fullPath);
      raw.forEach((segment, i) => {
        if (segment === '*' && i !== raw.length - 1) {
          throw new Error(`'*' 는 마지막 세그먼트만 가능: ${fullPath}`);
        }
      });
      const segments = raw.map((segment) => parseSegment(segment, fullPath));
      branches.push({ chain: nextChain, segments });
    });
  };

  visit(routes, '/', null, []);
  return branches;
};

const decodeSegments = (pathname: string) => {
  try {
    return splitPath(pathname).map(decodeURIComponent);
  } catch {
    throw new InvalidPathError(pathname);
  }
};

/** URL 세그먼트를 소비한 패턴 종류의 순위. 높을수록 구체적 */
const RANK = { static: 4, param: 3, optional: 2, splat: 1 } as const;

interface SegmentMatch {
  params: Record<string, string | undefined>;
  /** URL 세그먼트마다 그것을 소비한 패턴 순위 */
  ranks: number[];
  /** 비운 옵셔널·빈 와일드카드 수. 같은 순위면 적은 쪽이 구체적 */
  penalty: number;
}

const matchSegments = (
  segments: Segment[],
  parts: string[],
  si: number,
  pi: number,
  acc: SegmentMatch,
): SegmentMatch | null => {
  if (si === segments.length) return pi === parts.length ? acc : null;
  const segment = segments[si]!;
  const consume = (rank: number, params = acc.params): SegmentMatch => ({
    params,
    ranks: [...acc.ranks, rank],
    penalty: acc.penalty,
  });

  switch (segment.kind) {
    case 'splat': {
      const rest = parts.slice(pi);
      return {
        params: { ...acc.params, '*': rest.join('/') },
        ranks: [...acc.ranks, ...rest.map(() => RANK.splat)],
        penalty: acc.penalty + (rest.length === 0 ? 1 : 0),
      };
    }
    case 'static':
      return parts[pi] === segment.value
        ? matchSegments(segments, parts, si + 1, pi + 1, consume(RANK.static))
        : null;
    case 'param':
      return pi < parts.length
        ? matchSegments(
            segments,
            parts,
            si + 1,
            pi + 1,
            consume(RANK.param, { ...acc.params, [segment.name]: parts[pi] }),
          )
        : null;
    case 'optional': {
      if (pi < parts.length) {
        const taken = matchSegments(
          segments,
          parts,
          si + 1,
          pi + 1,
          consume(RANK.optional, { ...acc.params, [segment.name]: parts[pi] }),
        );
        if (taken) return taken;
      }
      return matchSegments(segments, parts, si + 1, pi, { ...acc, penalty: acc.penalty + 1 });
    }
  }
};

/** 앞 세그먼트부터 더 구체적인 쪽, 같으면 비운 옵셔널·빈 와일드카드가 적은 쪽 */
const compareMatches = (a: SegmentMatch, b: SegmentMatch) => {
  for (let i = 0; i < a.ranks.length; i += 1) {
    const diff = (b.ranks[i] ?? 0) - (a.ranks[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return a.penalty - b.penalty;
};

export type Matcher = (pathname: string) => RouteMatch[] | null;

export const createMatcher = (routes: RouteDef[]): Matcher => {
  const branches = flatten(routes);

  return (pathname) => {
    const parts = decodeSegments(pathname);
    let best: { branch: Branch; match: SegmentMatch } | null = null;
    for (const branch of branches) {
      const match = matchSegments(branch.segments, parts, 0, 0, {
        params: {},
        ranks: [],
        penalty: 0,
      });
      // 동점이면 먼저 정의된 라우트 (branches 는 정의 순서)
      if (match && (!best || compareMatches(match, best.match) < 0)) best = { branch, match };
    }
    if (!best) return null;
    const { params } = best.match;
    return best.branch.chain.map(({ id, route }) => ({ id, route, params }));
  };
};

export const defineRoutes = (routes: RouteDef[]): RouteDef[] => routes;
