import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    server: 'src/server/index.ts',
    client: 'src/client/index.tsx',
    node: 'src/node/index.ts',
    vite: 'src/vite/index.ts',
    web: 'src/web/index.ts',
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
