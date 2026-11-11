// 스펙 §11 런타임 크기 예산. dist 를 react·node 내장 모듈을 뺀 채 번들·압축해 잰다
import { gzipSync } from 'node:zlib';

import { build } from 'esbuild';

const KB = 1024;
const BUDGETS = [
  {
    name: '클라 런타임 (ssr-kit/client, min+gzip)',
    entry: 'dist/client.js',
    limit: 8 * KB,
    gzip: true,
    platform: 'browser',
  },
  {
    name: '서버 런타임 (server+node, min)',
    entry: ['dist/server.js', 'dist/node.js'],
    limit: 30 * KB,
    gzip: false,
    platform: 'node',
  },
];

const measure = async ({ entry, gzip, platform }) => {
  const result = await build({
    stdin: {
      contents: [entry].flat().map((file) => `export * from './${file}';`).join('\n'),
      resolveDir: process.cwd(),
    },
    bundle: true,
    minify: true,
    write: false,
    format: 'esm',
    platform,
    logLevel: 'error',
    external: ['react', 'react-dom', 'react/*', 'react-dom/*', 'node:*'],
  });
  const code = result.outputFiles[0].contents;
  return gzip ? gzipSync(code).length : code.length;
};

let failed = false;
for (const budget of BUDGETS) {
  const size = await measure(budget);
  const ok = size <= budget.limit;
  failed ||= !ok;
  console.log(`${ok ? '✓' : '✗'} ${budget.name}: ${(size / KB).toFixed(2)}KB / ${budget.limit / KB}KB`);
}
if (failed) process.exitCode = 1;
