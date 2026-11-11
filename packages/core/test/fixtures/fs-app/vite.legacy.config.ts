import path from 'node:path';

import legacy from '@vitejs/plugin-legacy';
import { defineConfig } from 'vite';

import { DEFAULT_FS_ROUTES_FILE, fsRoutes } from '../../../src/vite/fs-routes';
import { ssrKit } from '../../../src/vite/plugin';

const src = path.join(import.meta.dirname, '../../../src');

// plugin-legacy 는 환경마다 설정 파일을 다시 읽어 새 인스턴스를 만들어야 동작한다 (인라인 plugins 는 공유돼 깨진다)
export default defineConfig({
  base: '/cdn/',
  logLevel: 'silent',
  resolve: {
    alias: [
      { find: /^ssr-kit\/client$/, replacement: path.join(src, 'client/index.tsx') },
      { find: /^ssr-kit$/, replacement: path.join(src, 'index.ts') },
    ],
  },
  environments: {
    client: { build: { outDir: 'out/legacy-client' } },
    ssr: { build: { outDir: 'out/legacy-server' } },
  },
  plugins: [
    legacy({ targets: ['chrome >= 49'] }),
    fsRoutes({ dir: 'src/routes' }),
    ssrKit({ routes: DEFAULT_FS_ROUTES_FILE }),
  ],
});
