import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createBuilder, createServer } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { generateRoutesModule, scanRouteFiles, writeIfChanged } from '../src/vite/fs-routes';
import { ssrKit } from '../src/vite/plugin';
import { extractRoutePatterns, generateRoutesDts } from '../src/vite/typed-routes';

const extract = (code: string) => extractRoutePatterns('routes.ts', code);

describe('extractRoutePatterns (코드 라우트)', () => {
  it('중첩 children·절대 경로 자식·pathless 레이아웃·인덱스를 §4.1 규칙대로 잇는다', () => {
    const code = `
      import { defineRoutes } from 'ssr-kit';
      export default defineRoutes([
        {
          id: 'root',
          module: () => import('./Root'),
          children: [
            { path: '/', module: () => import('./Home') },
            {
              path: 'gold/',
              module: () => import('./GoldLayout'),
              children: [
                { module: () => import('./GoldIndex') },
                { path: ':id', module: () => import('./Gold') },
                { path: '/abs/:x?', module: () => import('./Abs') },
              ],
            },
            { path: ':lang?/about', module: () => import('./About') },
            { path: \`files/*\`, module: () => import('./Files') },
            { path: 'empty', children: [], module: () => import('./Empty') },
            { path: '/', module: () => import('./Dup') },
          ],
        },
      ]);
    `;
    expect(extract(code)).toEqual({
      patterns: ['/', '/gold', '/gold/:id', '/abs/:x?', '/:lang?/about', '/files/*', '/empty'],
    });
  });

  it('export const routes · export { routes } · as/satisfies 를 따라간다', () => {
    const route = `{ path: 'a', module: () => import('./A') }`;
    expect(extract(`export const routes = [${route}] satisfies RouteDef[];`)).toEqual({
      patterns: ['/a'],
    });
    expect(extract(`const list = [${route}] as RouteDef[];\nexport { list as routes };`)).toEqual({
      patterns: ['/a'],
    });
    expect(extract(`const list = defineRoutes([${route}]);\nexport default list;`)).toEqual({
      patterns: ['/a'],
    });
  });

  it.each([
    ['path 가 변수', `const p = 'a'; export default [{ path: p, module: () => import('./A') }];`],
    ['path 템플릿 식', "export default [{ path: `a/${x}`, module: () => import('./A') }];"],
    ['spread 라우트', `export default [{ ...base, module: () => import('./A') }];`],
    ['children 변수', `export default [{ children: kids, module: () => import('./A') }];`],
    ['라우트가 변수', `export default [home];`],
    ['배열이 import', `import list from './list';\nexport default list;`],
  ])('리터럴이 아니면 reason: %s', (_, code) => {
    expect(extract(code)).toHaveProperty('reason');
  });

  it('export 가 없으면 reason', () => {
    expect(extract('const routes = [];')).toEqual({ reason: 'default 또는 routes export 가 없다' });
  });
});

describe('extractRoutePatterns (fsRoutes 생성 파일)', () => {
  it('생성 파일의 리터럴 트리를 그대로 읽는다', () => {
    const tree = scanRouteFiles([
      '_layout.tsx',
      'index.tsx',
      'gold/_layout.tsx',
      'gold/index.tsx',
      'gold/[id].tsx',
      '[[lang]]/intro.tsx',
      'files/[...rest].tsx',
      '(auth)/login.tsx',
    ]);
    const code = generateRoutesModule(tree, (file) => `./${file}`);
    expect(extractRoutePatterns('routes.generated.js', code)).toEqual({
      patterns: ['/', '/login', '/:lang?/intro', '/files/*', '/gold/:id', '/gold'],
    });
  });
});

describe('generateRoutesDts', () => {
  it('Register 확장 선언을 만든다', () => {
    expect(generateRoutesDts(['/', '/gold/:id'])).toMatchInlineSnapshot(`
      "// ssr-kit 가 생성한 파일. 직접 수정하지 말 것 (ssrKit({ routesDts }))
      import 'ssr-kit';

      declare module 'ssr-kit' {
        interface Register {
          routes:
            | "/"
            | "/gold/:id";
        }
      }
      "
    `);
  });

  it('리터럴이 아니면 string, 라우트가 없으면 never', () => {
    expect(generateRoutesDts(null)).toContain('routes: string;');
    expect(generateRoutesDts([])).toContain('routes: never;');
  });
});

describe('routes d.ts 쓰기', () => {
  const tmpDirs: string[] = [];
  const makeRoot = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ssrk-typed-routes-'));
    tmpDirs.push(root);
    return root;
  };

  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('내용이 바뀌었을 때만 쓴다', () => {
    const file = path.join(makeRoot(), 'nested/routes.d.ts');
    expect(writeIfChanged(file, 'a')).toBe(true);
    const { mtimeMs } = fs.statSync(file);
    expect(writeIfChanged(file, 'a')).toBe(false);
    expect(fs.statSync(file).mtimeMs).toBe(mtimeMs);
    expect(writeIfChanged(file, 'b')).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe('b');
  });

  const resolveConfig = async (root: string, routesDts: boolean | string, warn = vi.fn()) => {
    const builder = await createBuilder({
      root,
      configFile: false,
      logLevel: 'silent',
      customLogger: {
        info: vi.fn(),
        warn,
        warnOnce: vi.fn(),
        error: vi.fn(),
        clearScreen: vi.fn(),
        hasErrorLogged: () => false,
        hasWarned: false,
      },
      plugins: [ssrKit({ routes: 'src/routes.ts', routesDts })],
    });
    return builder.config;
  };

  it('configResolved 에서 d.ts 를 쓰고, 리터럴이 아니면 경고 후 string 으로 쓴다', async () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, 'src'));
    const routes = path.join(root, 'src/routes.ts');
    fs.writeFileSync(routes, `export default [{ path: 'gold/:id', module: () => import('./G') }];`);

    await resolveConfig(root, true);
    const dts = fs.readFileSync(path.join(root, '.ssr-kit/routes.d.ts'), 'utf8');
    expect(dts).toContain('| "/gold/:id";');

    fs.writeFileSync(routes, `export default [{ path: p, module: () => import('./G') }];`);
    const warn = vi.fn();
    await resolveConfig(root, 'types/routes.d.ts', warn);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('path 가 문자열 리터럴이 아니다'));
    expect(fs.readFileSync(path.join(root, 'types/routes.d.ts'), 'utf8')).toContain(
      'routes: string;',
    );
  });

  it('routesDts 를 안 주면 아무것도 쓰지 않고, routes 파일이 없으면 경고만 한다', async () => {
    const root = makeRoot();
    await resolveConfig(root, false);
    expect(fs.existsSync(path.join(root, '.ssr-kit'))).toBe(false);

    const warn = vi.fn();
    await resolveConfig(root, true, warn);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('routes d.ts 생성 실패'));
  });

  it('dev 에서 routes 파일이 바뀌면 다시 쓴다', async () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, 'src'));
    const routes = path.join(root, 'src/routes.ts');
    const dts = path.join(root, '.ssr-kit/routes.d.ts');
    fs.writeFileSync(routes, `export default [{ path: 'a', module: () => import('./A') }];`);
    const server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      server: { middlewareMode: true, ws: false },
      plugins: [ssrKit({ routes: 'src/routes.ts', routesDts: true })],
    });
    try {
      expect(fs.readFileSync(dts, 'utf8')).toContain('| "/a";');
      fs.writeFileSync(routes, `export default [{ path: 'b', module: () => import('./B') }];`);
      server.watcher.emit('change', routes);
      await vi.waitFor(() => expect(fs.readFileSync(dts, 'utf8')).toContain('| "/b";'));
    } finally {
      await server.close();
    }
  });
});
