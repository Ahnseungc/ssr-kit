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
});
