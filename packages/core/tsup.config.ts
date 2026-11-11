import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    server: 'src/server/index.ts',
    client: 'src/client/index.tsx',
    node: 'src/node/index.ts',
    vite: 'src/vite/index.ts',
    web: 'src/web/index.ts',
    edge: 'src/edge/index.tsx',
    hono: 'src/hono/index.ts',
    fastify: 'src/fastify/index.ts',
    prerender: 'src/prerender/index.ts',
    'prerender-cli': 'src/prerender/cli.ts',
  },
  format: ['esm'],
  dts: true,
  target: 'es2020',
  sourcemap: true,
  clean: true,
  splitting: true,
  // Deno 등은 `node:` 접두사가 있어야 내장 모듈로 인식한다
  removeNodeProtocol: false,
  external: [
    'react',
    'react-dom',
    'vite',
    'oxc-parser',
    'magic-string',
    'ssr-kit',
    'fastify',
    'hono',
  ],
});
