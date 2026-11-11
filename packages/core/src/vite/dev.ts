import path from 'node:path';

import type { Connect, EnvironmentModuleNode, ViteDevServer } from 'vite';

import type { ResolvedAssets, ServerBuild } from '../server/build';
import { CLIENT_ENTRY, PLUGIN_NAME, SERVER_ENTRY, type SsrKitApi } from './plugin';

const CSS_FILE = /\.(css|less|sass|scss|styl|stylus|pcss|postcss)(?:$|\?)/;
const CSS_SKIP_QUERY = /[?&](inline|url|raw)\b/;

export interface DevServerOptions {
  root: string;
  configFile?: string;
}

export interface DevServer {
  middlewares: Connect.Server;
  getBuild: () => Promise<ServerBuild>;
  close: () => Promise<void>;
  vite: ViteDevServer;
}

const collectStyles = (entries: (EnvironmentModuleNode | undefined)[]) => {
  const styles = new Set<string>();
  const seen = new Set<EnvironmentModuleNode>();
  const visit = (node: EnvironmentModuleNode | undefined) => {
    if (!node || seen.has(node)) return;
    seen.add(node);
    const id = node.id ?? node.url;
    if (CSS_FILE.test(id) && !CSS_SKIP_QUERY.test(id)) {
      styles.add(node.url);
      return;
    }
    if (id.includes('/node_modules/')) return;
    node.importedModules.forEach(visit);
  };
  entries.forEach(visit);
  return [...styles];
};

const withBase = (base: string, url: string) => `${base.replace(/\/$/, '')}${url}`;

export const createDevServer = async (options: DevServerOptions): Promise<DevServer> => {
  const { createServer, isRunnableDevEnvironment, normalizePath } = await import('vite');
  const vite = await createServer({
    root: options.root,
    configFile: options.configFile,
    server: { middlewareMode: true },
    appType: 'custom',
  });
  const env = vite.environments.ssr;
  if (!env || !isRunnableDevEnvironment(env)) {
    throw new Error('Vite ssr 환경이 RunnableDevEnvironment 가 아니다');
  }
  const plugin = vite.config.plugins.find((p) => p.name === PLUGIN_NAME);
  if (!plugin) throw new Error('vite.config 에 ssrKit() 플러그인이 없다');
  const api = plugin.api as SsrKitApi;
  const base = vite.config.base;

  const resolveAssets = async (files: string[]): Promise<ResolvedAssets> => {
    const graph = env.moduleGraph;
    const entries = files.map((file) => normalizePath(path.resolve(vite.config.root, file)));
    const documentFile = api.documentFile();
    if (documentFile) entries.push(documentFile);
    const styles = collectStyles(entries.map((id) => graph.getModuleById(id)));
    return {
      modules: [],
      styles: styles.map((url) => withBase(base, `${url}${url.includes('?') ? '&' : '?'}direct`)),
    };
  };

  const getBuild = async (): Promise<ServerBuild> => {
    const { build } = await env.runner.import<{ build: ServerBuild }>(SERVER_ENTRY);
    return {
      ...build,
      dev: true,
      bootstrapModules: [
        withBase(base, '/@vite/client'),
        withBase(base, `/@id/__x00__${CLIENT_ENTRY}`),
      ],
      // 스택은 모듈 러너가 이미 소스맵으로 고쳐 준다 (ssrFixStacktrace 를 또 부르면 경고가 붙는다)
      resolveAssets,
    };
  };

  return { middlewares: vite.middlewares, getBuild, close: () => vite.close(), vite };
};
