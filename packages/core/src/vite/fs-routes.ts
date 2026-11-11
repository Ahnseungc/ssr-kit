/**
 * 파일 기반 라우팅 (PRD RT5). `dir` 아래 파일로 routes 파일을 생성한다.
 *
 * 규칙 (경로는 dir 기준):
 * - `_layout.tsx`       그 폴더의 레이아웃. 루트면 pathless, 아니면 path = 폴더 세그먼트
 * - `index.tsx`         인덱스 라우트 (자기 세그먼트 없음)
 * - `[id].tsx`          `:id`
 * - `[[lang]]`          `:lang?`
 * - `[...rest].tsx`     `*` (마지막 세그먼트만)
 * - `(group)/`          세그먼트 없는 묶음. `_layout` 이 있으면 pathless 레이아웃
 * - 무시: `_layout` 외 `_` 로 시작하는 파일·폴더, `*.test.*`, `*.spec.*`, `*.stories.*`, `*.server.*`,
 *   `.d.ts`, 확장자 .tsx .ts .jsx .js 이외
 * - 라우트 id = dir 기준 파일 경로에서 확장자를 뺀 값 (`gold/[id]`, `gold/_layout`)
 *
 * 생성 파일은 `() => import('리터럴')` 형태를 유지해 ssrKit 의 routes 스캔(§6.2)을 그대로 탄다.
 * 사용: `plugins: [fsRoutes({ dir: 'src/routes' }), ssrKit({ routes: DEFAULT_FS_ROUTES_FILE })]`
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Plugin } from 'vite';

export const DEFAULT_FS_ROUTES_FILE = 'node_modules/.ssr-kit/routes.generated.js';
const PLUGIN_NAME = 'ssr-kit:fs-routes';
const LAYOUT_NAME = '_layout';
const INDEX_NAME = 'index';
const ROUTE_FILE = /^(.+)\.(tsx|ts|jsx|js)$/;
const IGNORED_FILE = /\.(test|spec|stories|server)\.[^.]+$|\.d\.ts$/;
const IGNORED_PREFIX = '_';
const GROUP = /^\(.+\)$/;
const SPLAT = /^\[\.\.\.(.+)\]$/;
const OPTIONAL = /^\[\[(.+)\]\]$/;
const PARAM = /^\[(.+)\]$/;
const INDENT = '  ';

export interface FsRoutesOptions {
  /** 라우트 폴더 (root 기준) */
  dir: string;
  /** 생성 파일 경로 (root 기준). ssrKit({ routes }) 와 같아야 한다 */
  outFile?: string;
}

/** 생성 대상 라우트. file 은 dir 기준 posix 경로 */
export interface FsRouteNode {
  id: string;
  file: string;
  path?: string;
  children?: FsRouteNode[];
}

interface DirNode {
  layout?: string;
  files: Map<string, string>;
  dirs: Map<string, DirNode>;
}

const createDir = (): DirNode => ({ files: new Map(), dirs: new Map() });

/** 폴더·파일 이름 → 경로 세그먼트. undefined 면 세그먼트 없음 */
export const toSegment = (name: string): string | undefined => {
  if (name === INDEX_NAME || GROUP.test(name)) return undefined;
  const splat = SPLAT.exec(name);
  if (splat) return '*';
  const optional = OPTIONAL.exec(name);
  if (optional) return `:${optional[1]}?`;
  const param = PARAM.exec(name);
  if (param) return `:${param[1]}`;
  return name;
};

const isIgnoredSegment = (segment: string) =>
  segment.startsWith(IGNORED_PREFIX) && segment !== LAYOUT_NAME;

/** 라우트가 될 파일이면 확장자 뺀 경로 조각들을 돌려준다 */
const parseFile = (file: string): string[] | null => {
  const posix = file.split(path.sep).join('/');
  const match = ROUTE_FILE.exec(posix);
  if (!match || IGNORED_FILE.test(posix)) return null;
  const parts = match[1]!.split('/');
  return parts.some(isIgnoredSegment) ? null : parts;
};

const insertFile = (root: DirNode, parts: string[], file: string) => {
  const name = parts.at(-1)!;
  let dir = root;
  for (const folder of parts.slice(0, -1)) {
    if (!dir.dirs.has(folder)) dir.dirs.set(folder, createDir());
    dir = dir.dirs.get(folder)!;
  }
  const existing = name === LAYOUT_NAME ? dir.layout : dir.files.get(name);
  if (existing) throw new Error(`같은 라우트 id 의 파일이 둘이다: ${existing}, ${file}`);
  if (name === LAYOUT_NAME) dir.layout = file;
  else dir.files.set(name, file);
};

const joinSegments = (segments: (string | undefined)[]) => {
  const joined = segments.filter(Boolean).join('/');
  return joined || undefined;
};

const stripExt = (file: string) => file.replace(ROUTE_FILE, '$1');

// 결정적 순서를 위해 코드 포인트 비교 (localeCompare 는 환경 의존)
const byName = <T>([a]: [string, T], [b]: [string, T]) => (a < b ? -1 : a > b ? 1 : 0);

/** segments = 가장 가까운 레이아웃 이후 쌓인 세그먼트 */
const buildDir = (dir: DirNode, segments: string[]): FsRouteNode[] => {
  const leaves = [...dir.files].sort(byName).map(([name, file]) => ({
    id: stripExt(file),
    file,
    path: joinSegments([...segments, toSegment(name)]),
  }));
  const nested = [...dir.dirs].sort(byName).flatMap(([name, child]) => {
    const segment = toSegment(name);
    const childSegments = segment ? [...segments, segment] : segments;
    if (!child.layout) return buildDir(child, childSegments);
    return [layoutNode(child, child.layout, joinSegments(childSegments))];
  });
  return [...leaves, ...nested];
};

const layoutNode = (dir: DirNode, file: string, routePath: string | undefined): FsRouteNode => {
  const node: FsRouteNode = { id: stripExt(file), file, path: routePath };
  const children = buildDir(dir, []);
  return children.length ? { ...node, children } : node;
};

/** dir 기준 파일 목록 → 라우트 트리 (I/O 없음) */
export const scanRouteFiles = (files: string[]): FsRouteNode[] => {
  const root = createDir();
  for (const file of files) {
    const parts = parseFile(file);
    if (parts) insertFile(root, parts, parts.join('/') + path.extname(file));
  }
  return root.layout ? [layoutNode(root, root.layout, undefined)] : buildDir(root, []);
};

const printNode = (node: FsRouteNode, importPathFor: (file: string) => string, depth: number) => {
  const pad = INDENT.repeat(depth);
  const inner = pad + INDENT;
  const lines = [`${pad}{`, `${inner}id: ${JSON.stringify(node.id)},`];
  if (node.path !== undefined) lines.push(`${inner}path: ${JSON.stringify(node.path)},`);
  lines.push(`${inner}module: () => import(${JSON.stringify(importPathFor(node.file))}),`);
  if (node.children) {
    lines.push(`${inner}children: [`);
    for (const child of node.children) lines.push(printNode(child, importPathFor, depth + 2));
    lines.push(`${inner}],`);
  }
  lines.push(`${pad}},`);
  return lines.join('\n');
};

/** 라우트 트리 → routes 모듈 소스 */
export const generateRoutesModule = (
  tree: FsRouteNode[],
  importPathFor: (file: string) => string,
) =>
  [
    `// ${PLUGIN_NAME} 가 생성한 파일. 직접 수정하지 말 것`,
    `import { defineRoutes } from 'ssr-kit';`,
    '',
    'export default defineRoutes([',
    ...tree.map((node) => printNode(node, importPathFor, 1)),
    ']);',
    '',
  ].join('\n');

const listFiles = (dir: string) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)));

const readOrEmpty = (file: string) => {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
};

/** 내용이 바뀌었을 때만 써서 watcher 루프를 막는다. 썼으면 true */
export const writeIfChanged = (file: string, content: string): boolean => {
  if (readOrEmpty(file) === content) return false;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  return true;
};

/** 생성 파일을 쓴다. 썼으면 true */
export const writeRoutesFile = (dirAbs: string, outAbs: string): boolean => {
  const outDir = path.dirname(outAbs);
  const importPathFor = (file: string) => {
    const relative = path.relative(outDir, path.join(dirAbs, file)).split(path.sep).join('/');
    return relative.startsWith('.') ? relative : `./${relative}`;
  };
  return writeIfChanged(
    outAbs,
    generateRoutesModule(scanRouteFiles(listFiles(dirAbs)), importPathFor),
  );
};

const isInside = (dir: string, file: string) => {
  const relative = path.relative(dir, file);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

/** 파일 기반 라우팅 Vite 플러그인. ssrKit 보다 앞에 둔다 */
export const fsRoutes = (options: FsRoutesOptions): Plugin => {
  let dirAbs = '';
  let outAbs = '';

  return {
    name: PLUGIN_NAME,
    enforce: 'pre',

    configResolved(config) {
      dirAbs = path.resolve(config.root, options.dir);
      outAbs = path.resolve(config.root, options.outFile ?? DEFAULT_FS_ROUTES_FILE);
      try {
        writeRoutesFile(dirAbs, outAbs);
      } catch (error) {
        throw new Error(`${PLUGIN_NAME}: routes 파일 생성 실패 (${options.dir})`, {
          cause: error,
        });
      }
    },

    configureServer(server) {
      const regenerate = (file: string) => {
        if (!isInside(dirAbs, file)) return;
        try {
          // node_modules 는 watcher 가 무시하므로 직접 change 를 알려 ssrKit 이 다시 스캔하게 한다
          if (writeRoutesFile(dirAbs, outAbs)) server.watcher.emit('change', outAbs);
        } catch (error) {
          server.config.logger.error(`${PLUGIN_NAME}: routes 파일 재생성 실패`, {
            error: error as Error,
          });
        }
      };
      server.watcher.on('add', regenerate);
      server.watcher.on('unlink', regenerate);
    },
  };
};
