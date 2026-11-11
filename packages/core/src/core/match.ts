import type { RouteDef, RouteMatch } from './types';

type Segment =
  | { kind: 'static'; value: string }
  | { kind: 'param'; name: string }
  | { kind: 'optional'; name: string }
  | { kind: 'splat' };

interface Branch {
  chain: { id: string; route: RouteDef }[];
  segments: Segment[];
  score: number;
  order: number;
}

const SCORE = { static: 10, param: 3, optional: 2, splat: 1 } as const;

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

const joinPath = (parent: string, path: string | undefined) => {
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
      const score = segments.reduce((sum, s) => sum + SCORE[s.kind], 0);
      branches.push({ chain: nextChain, segments, score, order: branches.length });
    });
  };

  visit(routes, '/', null, []);
  return branches.sort((a, b) => b.score - a.score || a.order - b.order);
};

const decodeSegments = (pathname: string) => {
  try {
    return splitPath(pathname).map(decodeURIComponent);
  } catch {
    throw new InvalidPathError(pathname);
  }
};

const matchSegments = (
  segments: Segment[],
  parts: string[],
  si: number,
  pi: number,
  params: Record<string, string | undefined>,
): Record<string, string | undefined> | null => {
  if (si === segments.length) return pi === parts.length ? params : null;
  const segment = segments[si]!;

  switch (segment.kind) {
    case 'splat':
      return { ...params, '*': parts.slice(pi).join('/') };
    case 'static':
      return parts[pi] === segment.value
        ? matchSegments(segments, parts, si + 1, pi + 1, params)
        : null;
    case 'param':
      return pi < parts.length
        ? matchSegments(segments, parts, si + 1, pi + 1, { ...params, [segment.name]: parts[pi] })
        : null;
    case 'optional': {
      if (pi < parts.length) {
        const taken = matchSegments(segments, parts, si + 1, pi + 1, {
          ...params,
          [segment.name]: parts[pi],
        });
        if (taken) return taken;
      }
      return matchSegments(segments, parts, si + 1, pi, params);
    }
  }
};

export type Matcher = (pathname: string) => RouteMatch[] | null;

export const createMatcher = (routes: RouteDef[]): Matcher => {
  const branches = flatten(routes);

  return (pathname) => {
    const parts = decodeSegments(pathname);
    for (const branch of branches) {
      const params = matchSegments(branch.segments, parts, 0, 0, {});
      if (params) return branch.chain.map(({ id, route }) => ({ id, route, params }));
    }
    return null;
  };
};

export const defineRoutes = (routes: RouteDef[]): RouteDef[] => routes;
