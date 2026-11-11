import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import type { ServerBuild } from '../server/build';
import { prerender, type PrerenderResult } from './index';

const USAGE =
  'usage: ssr-kit-prerender --entry dist/server/entry.js --out dist/client [--origin URL] <path...>';
const DEFAULT_ENTRY = 'dist/server/entry.js';
const DEFAULT_OUT = 'dist/client';
const STATUS_OK = 200;
const STATUS_WIDTH = 4;

const parseCli = (argv: string[]) => {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      entry: { type: 'string', default: DEFAULT_ENTRY },
      out: { type: 'string', default: DEFAULT_OUT },
      origin: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  return { ...values, paths: positionals };
};

const loadBuild = async (entry: string): Promise<ServerBuild> => {
  const mod = (await import(pathToFileURL(resolve(entry)).href)) as { build?: ServerBuild };
  if (!mod.build) throw new Error(`${entry} has no build export`);
  return mod.build;
};

const describe = (result: PrerenderResult) => {
  if (result.file) return result.file;
  if (result.location) return `→ ${result.location}`;
  if (result.error) return String(result.error);
  return '(no file)';
};

const printSummary = (results: PrerenderResult[]) => {
  const width = Math.max(...results.map((r) => r.path.length));
  for (const result of results) {
    const status = String(result.status).padEnd(STATUS_WIDTH);
    console.log(`${status} ${result.path.padEnd(width)}  ${describe(result)}`);
  }
};

const main = async () => {
  const args = parseCli(process.argv.slice(2));
  if (args.help || args.paths.length === 0) {
    console.log(USAGE);
    process.exitCode = args.help ? 0 : 1;
    return;
  }
  const build = await loadBuild(args.entry);
  const results = await prerender({
    build,
    paths: args.paths,
    outDir: args.out,
    origin: args.origin,
  });
  printSummary(results);
  if (results.some((r) => r.status !== STATUS_OK)) process.exitCode = 1;
};

main().catch((error: unknown) => {
  console.error('[ssr-kit] prerender failed', error);
  process.exitCode = 1;
});
