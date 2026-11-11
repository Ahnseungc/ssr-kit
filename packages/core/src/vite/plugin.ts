import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Manifest, Plugin, ResolvedConfig, Rollup } from 'vite';

import type { AssetManifest } from '../server/build';
import { annotateRoutesFile, type RoutesFileInfo, scanRoutesFile } from './routes';
import { stripServerExports } from './strip';

export const CLIENT_ENTRY = 'virtual:ssr-kit/client-entry';
export const SERVER_ENTRY = 'virtual:ssr-kit/server-entry';
export const PLUGIN_NAME = 'ssr-kit';

const DEFAULT_DATA_PREFIX = '/_data';
const REACT_PREAMBLE_PLUGIN = 'vite:react-virtual-preamble';
const SERVER_ONLY_FILE = /\.server\.[cm]?[jt]sx?$/;
const CLIENT_DEPS = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
];

export interface SsrKitPluginOptions {
  /** routes 파일 경로 (root 기준) */
  routes: string;
  /** Document 컴포넌트 파일 경로 */
  document?: string;
  /** 기본 '/_data' */
  dataPrefix?: string;
}

/** createDevServer 가 플러그인 설정을 읽는 통로 */
export interface SsrKitApi {
  routesFile: () => string;
  documentFile: () => string | undefined;
  routeModuleFiles: () => Promise<Set<string>>;
}

interface Discovery {
  info: RoutesFileInfo;
  /** import 문자열 → 매니페스트 키 */
  keys: Map<string, string>;
  /** 라우트 모듈 절대 경로 */
  files: Set<string>;
}

type Resolve = Rollup.PluginContext['resolve'];

const cleanId = (id: string) => id.replace(/[?#].*$/, '');

/** 라우트 모듈의 비컴포넌트 export. React Refresh 경계 검사에서 뺀다 */
const ROUTE_NON_COMPONENT_EXPORTS = ['loader', 'head', '__ssrkLoader'];

/**
 * dev: 라우트 모듈을 React Refresh 경계로 인정받게 하고(상태 보존),
 * 바뀌면 현재 로더를 다시 실행해 서버 쪽 변경도 반영한다.
 * 소스맵은 끝에 붙이는 코드라 원본 위치에 영향이 없어 생략한다.
 */
const appendRouteHmr = (file: string, code: string) => ({
  code: `${code}
if (import.meta.hot) {
  const routeFiles = (window.__ssrkRouteFiles ??= new Set());
  routeFiles.add(${JSON.stringify(file)});
  window.__getReactRefreshIgnoredExports ??= ({ id }) =>
    window.__ssrkRouteFiles.has(id) ? ${JSON.stringify(ROUTE_NON_COMPONENT_EXPORTS)} : [];
  import.meta.hot.accept(() => window.__ssrkRevalidate?.());
}
`,
  map: null,
});

const toAssetManifest = (manifest: Manifest, keys: Iterable<string>): AssetManifest => {
  const flatten = (key: string, seen = new Set<string>()) => {
    const files: string[] = [];
    const css: string[] = [];
    const visit = (current: string) => {
      const chunk = manifest[current];
      if (!chunk || seen.has(current)) return;
      seen.add(current);
      css.push(...(chunk.css ?? []));
      for (const imported of chunk.imports ?? []) {
        if (manifest[imported]) files.push(manifest[imported].file);
        visit(imported);
      }
    };
    visit(key);
    return { files, css };
  };

  const entryKey = Object.keys(manifest).find((key) => manifest[key]!.isEntry);
  if (!entryKey) throw new Error('client 매니페스트에 엔트리가 없다');
  const entry = flatten(entryKey);

  const modules: AssetManifest['modules'] = {};
  for (const key of keys) {
    const chunk = manifest[key];
    if (!chunk) continue;
    const { files, css } = flatten(key);
    modules[key] = { file: chunk.file, imports: files, css };
  }
  return { entry: { file: manifest[entryKey]!.file, css: entry.css }, modules };
};

export const ssrKit = (options: SsrKitPluginOptions): Plugin => {
  const dataPrefix = options.dataPrefix ?? DEFAULT_DATA_PREFIX;
  let config: ResolvedConfig;
  let routesFile = '';
  let documentFile: string | undefined;
  let hasReactPreamble = false;
  let discovery: Promise<Discovery> | null = null;

  const toKey = (file: string) => path.relative(config.root, file).split(path.sep).join('/');

  const discover = (resolve: Resolve): Promise<Discovery> => {
    discovery ??= (async () => {
      const info = scanRoutesFile(routesFile, await readFile(routesFile, 'utf8'));
      const keys = new Map<string, string>();
      const files = new Set<string>();
      for (const item of info.imports) {
        const resolved = await resolve(item.source, routesFile);
        if (!resolved) throw new Error(`라우트 모듈을 찾을 수 없다: ${item.source}`);
        const file = cleanId(resolved.id);
        files.add(file);
        keys.set(item.source, toKey(file));
      }
      return { info, keys, files };
    })().catch((error) => {
      discovery = null;
      throw error;
    });
    return discovery;
  };

  const importLines = (info: RoutesFileInfo) => {
    const routes = JSON.stringify(routesFile);
    const lines = [
      info.hasDefaultExport ? `import routes from ${routes};` : `import { routes } from ${routes};`,
    ];
    if (!info.hasDefaultExport && !info.hasRoutesExport) {
      throw new Error(
        `${options.routes} 는 default 또는 routes 이름으로 라우트를 export 해야 한다`,
      );
    }
    lines.push(
      documentFile
        ? `import Document from ${JSON.stringify(documentFile)};`
        : 'const Document = undefined;',
    );
    return lines;
  };

  const clientEntry = (info: RoutesFileInfo) =>
    [
      ...(hasReactPreamble ? [`import '@vitejs/plugin-react/preamble';`] : []),
      `import { hydrate } from 'ssr-kit/client';`,
      ...importLines(info),
      `hydrate({ routes, Document, dataPrefix: ${JSON.stringify(dataPrefix)}, dev: import.meta.env.DEV });`,
    ].join('\n');

  const serverEntry = async (discovered: Discovery, isBuild: boolean) => {
    const lines = importLines(discovered.info);
    const common = `routes, Document, dataPrefix: ${JSON.stringify(dataPrefix)}`;
    if (!isBuild) {
      return [
        ...lines,
        `export const build = { ${common}, dev: true, bootstrapModules: [], resolveAssets: () => ({ modules: [], styles: [] }) };`,
      ].join('\n');
    }
    const outDir = path.resolve(config.root, config.environments.client!.build.outDir);
    const manifest = JSON.parse(
      await readFile(path.join(outDir, '.vite/manifest.json'), 'utf8'),
    ) as Manifest;
    const assets = toAssetManifest(manifest, discovered.keys.values());
    return [
      `import { createManifestAssets } from 'ssr-kit/server';`,
      ...lines,
      `const manifest = ${JSON.stringify(assets)};`,
      `export const build = { ${common}, dev: false, ...createManifestAssets(manifest, ${JSON.stringify(config.base)}) };`,
    ].join('\n');
  };

  const isServerOnly = (file: string) => {
    const rel = path.relative(config.root, file);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
    const segments = rel.split(path.sep);
    if (segments.includes('node_modules')) return false;
    return SERVER_ONLY_FILE.test(rel) || segments.slice(0, -1).includes('server');
  };

  const api: SsrKitApi = {
    routesFile: () => routesFile,
    documentFile: () => documentFile,
    routeModuleFiles: async () => (await discovery)?.files ?? new Set(),
  };

  return {
    name: PLUGIN_NAME,
    api,

    config: () => ({
      appType: 'custom',
      ssr: { external: ['ssr-kit'] },
      environments: {
        client: {
          build: {
            outDir: 'dist/client',
            manifest: true,
            rolldownOptions: { input: CLIENT_ENTRY },
          },
          // 가상 엔트리는 의존성 스캔에 안 잡혀 dev 첫 로드에 재최적화 → React 두 벌. 미리 포함한다
          optimizeDeps: { include: CLIENT_DEPS },
        },
        ssr: {
          build: {
            outDir: 'dist/server',
            rolldownOptions: {
              input: { entry: SERVER_ENTRY },
              output: { entryFileNames: '[name].js' },
            },
          },
        },
      },
      builder: {
        async buildApp(builder) {
          await builder.build(builder.environments.client!);
          await builder.build(builder.environments.ssr!);
        },
      },
    }),

    configResolved(resolved) {
      config = resolved;
      routesFile = path.resolve(resolved.root, options.routes);
      documentFile = options.document ? path.resolve(resolved.root, options.document) : undefined;
      hasReactPreamble = resolved.plugins.some((p) => p.name === REACT_PREAMBLE_PLUGIN);
    },

    resolveId(id) {
      if (id === CLIENT_ENTRY || id === SERVER_ENTRY) return `\0${id}`;
    },

    async load(id) {
      if (id === `\0${CLIENT_ENTRY}`) {
        return clientEntry((await discover(this.resolve.bind(this))).info);
      }
      if (id === `\0${SERVER_ENTRY}`) {
        const discovered = await discover(this.resolve.bind(this));
        return serverEntry(discovered, this.environment.mode === 'build');
      }
    },

    async transform(code, id) {
      const file = cleanId(id);
      if (file === routesFile) {
        const { keys } = await discover(this.resolve.bind(this));
        return annotateRoutesFile(code, scanRoutesFile(file, code).imports, keys);
      }
      if (this.environment.config.consumer !== 'client') return;

      if (isServerOnly(file)) {
        const importers =
          this.environment.mode === 'build' ? (this.getModuleInfo(id)?.importers ?? []) : [];
        this.error(
          `서버 전용 모듈이 클라이언트 번들에 들어왔다: ${toKey(file)}` +
            (importers.length ? ` (import 한 곳: ${importers.map(toKey).join(', ')})` : ''),
        );
      }
      const { files } = await discover(this.resolve.bind(this));
      if (!files.has(file)) return;
      const stripped = stripServerExports(file, code);
      if (this.environment.mode !== 'dev') return stripped;
      return appendRouteHmr(file, stripped?.code ?? code);
    },

    watchChange(id) {
      if (cleanId(id) === routesFile) discovery = null;
    },

    hotUpdate({ file }) {
      if (file === routesFile) discovery = null;
    },
  };
};
