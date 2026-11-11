import { readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import { createBuilder } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';

import { DEFAULT_FS_ROUTES_FILE, fsRoutes } from '../src/vite/fs-routes';
import { ssrKit } from '../src/vite/plugin';

const root = path.join(import.meta.dirname, 'fixtures/fs-app');
const src = path.join(import.meta.dirname, '../src');
const BUILD_TIMEOUT_MS = 30_000;

const readDir = (dir: string) =>
  readdirSync(dir)
    .map((file) => readFileSync(path.join(dir, file), 'utf8'))
    .join('\n');

describe('Vite 빌드 통합 (fsRoutes + ssrKit)', () => {
  afterAll(() => {
    rmSync(path.join(root, 'dist'), { recursive: true, force: true });
    rmSync(path.join(root, 'out'), { recursive: true, force: true });
    rmSync(path.join(root, 'node_modules'), { recursive: true, force: true });
  });

  it(
    '파일 라우트로 client·ssr 를 빌드하고 클라 번들에서 서버 코드를 뺀다',
    async () => {
      const builder = await createBuilder({
        root,
        configFile: false,
        logLevel: 'silent',
        resolve: {
          alias: [
            { find: /^ssr-kit\/client$/, replacement: path.join(src, 'client/index.tsx') },
            { find: /^ssr-kit$/, replacement: path.join(src, 'index.ts') },
          ],
        },
        plugins: [fsRoutes({ dir: 'src/routes' }), ssrKit({ routes: DEFAULT_FS_ROUTES_FILE })],
      });
      await builder.buildApp();

      const generated = readFileSync(path.join(root, DEFAULT_FS_ROUTES_FILE), 'utf8');
      expect(generated).toContain('gold/[id]');

      const server = readFileSync(path.join(root, 'dist/server/entry.js'), 'utf8');
      expect(server).toContain('"src/routes/gold/[id].tsx"');
      expect(server).toMatch(/"path":\s*"gold\/:id"|path: "gold\/:id"/);

      const client = readDir(path.join(root, 'dist/client/assets'));
      expect(client).not.toContain('fixture-server-secret');
      expect(client).toContain('__ssrkLoader');

      const manifest = JSON.parse(
        readFileSync(path.join(root, 'dist/client/.vite/manifest.json'), 'utf8'),
      ) as Record<string, unknown>;
      expect(Object.keys(manifest)).toContain('src/routes/gold/[id].tsx');
    },
    BUILD_TIMEOUT_MS,
  );

  it(
    '사용자가 정한 outDir·build.target 을 덮어쓰지 않는다',
    async () => {
      const builder = await createBuilder({
        root,
        configFile: false,
        logLevel: 'silent',
        resolve: {
          alias: [
            { find: /^ssr-kit\/client$/, replacement: path.join(src, 'client/index.tsx') },
            { find: /^ssr-kit$/, replacement: path.join(src, 'index.ts') },
          ],
        },
        environments: {
          client: { build: { outDir: 'out/web', target: 'es2017' } },
          ssr: { build: { outDir: 'out/node' } },
        },
        plugins: [fsRoutes({ dir: 'src/routes' }), ssrKit({ routes: DEFAULT_FS_ROUTES_FILE })],
      });
      await builder.buildApp();
      const client = readDir(path.join(root, 'out/web/assets'));
      expect(client).not.toMatch(/\?\.|\?\?/);
      const server = readFileSync(path.join(root, 'out/node/entry.js'), 'utf8');
      expect(server).toContain('"src/routes/gold/[id].tsx"');
    },
    BUILD_TIMEOUT_MS,
  );

  it(
    '@vitejs/plugin-legacy: 모던 엔트리로 부트스트랩하고 레거시 폴리필·엔트리를 tailHtml 로 낸다',
    async () => {
      const builder = await createBuilder({
        root,
        configFile: path.join(root, 'vite.legacy.config.ts'),
      });
      await builder.buildApp();
      const server = readFileSync(path.join(root, 'out/legacy-server/entry.js'), 'utf8');
      expect(server).toContain('createTailHtml');
      expect(server).toMatch(
        /nomodule crossorigin id=\\"vite-legacy-polyfill\\" src=\\"\/cdn\/assets\/polyfills-legacy-/,
      );
      expect(server).toMatch(
        /id=\\"vite-legacy-entry\\" data-src=\\"\/cdn\/assets\/client-entry-legacy-/,
      );
      // 부트스트랩·라우트 프리로드는 모던 청크 (레거시 엔트리도 isEntry 라 골라야 한다)
      expect(server).toMatch(/"file": "assets\/client-entry-(?!legacy)[\w-]+\.js"/);
      expect(server).not.toMatch(/"file": "assets\/[\w-]+-legacy-[\w-]+\.js"/);
      const client = readdirSync(path.join(root, 'out/legacy-client/assets'));
      expect(client.some((file) => file.startsWith('client-entry-legacy-'))).toBe(true);
    },
    BUILD_TIMEOUT_MS,
  );
});
