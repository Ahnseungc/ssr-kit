import { describe, expect, it } from 'vitest';

import { annotateRoutesFile, scanRoutesFile } from '../src/vite/routes';
import { stripServerExports } from '../src/vite/strip';

const strip = (code: string) => stripServerExports('/app/src/pages/Page.jsx', code)?.code ?? null;

describe('stripServerExports', () => {
  it('export const loader 와 로더 전용 헬퍼·import 를 지우고 표시를 남긴다', () => {
    const out = strip(`
import { db } from './db.server';
import { format } from './format';
import 'side-effect';
const query = (id) => db.find(id);
function unrelated() { return 1; }
export const loader = async ({ params }) => ({ gold: await query(params.id) });
export const head = ({ data }) => ({ title: format(data.gold.name) });
export default function Page() { return <h1>{unrelated()}</h1>; }
`);
    expect(out).not.toContain('db.server');
    expect(out).not.toContain('query');
    expect(out).not.toMatch(/export const loader/);
    expect(out).toContain(`import { format } from './format';`);
    expect(out).toContain(`import 'side-effect';`);
    expect(out).toContain('function unrelated');
    expect(out).toContain('export const __ssrkLoader = true;');
  });

  it('export function loader 와 연쇄 헬퍼를 고정점까지 지운다', () => {
    const out = strip(`
import secret, { a as b } from './secret.server';
const inner = () => secret;
const outer = () => inner() + b;
export async function loader() { return outer(); }
export default () => null;
`);
    expect(out).not.toContain('secret');
    expect(out).not.toContain('inner');
    expect(out).not.toContain('outer');
  });

  it('export { loader } 지정자와 로컬 선언을 지우고 나머지 export 는 남긴다', () => {
    const out = strip(`
import { db } from './db.server';
const loader = () => db.all();
const head = () => ({});
export { loader, head };
export default () => null;
`);
    expect(out).not.toContain('db');
    expect(out).toContain('export { head };');
    expect(out).not.toMatch(/const loader/);
  });

  it('import 일부만 쓰이면 해당 지정자만 남긴다', () => {
    const out = strip(`
import React, { useState, useMemo } from 'react';
export const loader = () => useMemo;
export default function Page() { const [s] = useState(0); return React.createElement('p', null, s); }
`);
    expect(out).toContain(`import React, { useState } from 'react';`);
  });

  it('JSX 컴포넌트·속성 이름 참조를 구분한다', () => {
    const out = strip(`
import { Chart } from './Chart';
import { title } from './server-title.server';
export const loader = () => title;
export default function Page() { return <Chart title="x" />; }
`);
    expect(out).toContain(`import { Chart } from './Chart';`);
    expect(out).not.toContain('server-title');
  });

  it('loader 가 없으면 변환하지 않는다', () => {
    expect(strip(`export const head = () => ({}); export default () => null;`)).toBeNull();
    expect(strip(`const loaderText = 'loader'; export default () => loaderText;`)).toBeNull();
  });

  it('여러 선언이 섞인 export const loader 는 에러', () => {
    expect(() => strip(`export const loader = () => 1, other = 2;`)).toThrow(/따로/);
  });
});

describe('routes 파일', () => {
  const code = `
import { defineRoutes } from 'ssr-kit';
export default defineRoutes([
  { path: '/', module: () => import('./pages/Home') },
  { path: '/gold/:id', module: () => import('./pages/Gold') },
]);
`;

  it('() => import 리터럴과 export 형태를 찾는다', () => {
    const info = scanRoutesFile('/app/src/routes.ts', code);
    expect(info.imports.map((i) => i.source)).toEqual(['./pages/Home', './pages/Gold']);
    expect(info.hasDefaultExport).toBe(true);
  });

  it('__ssrkModule 로 감싸 매니페스트 키를 붙인다', () => {
    const info = scanRoutesFile('/app/src/routes.ts', code);
    const out = annotateRoutesFile(
      code,
      info.imports,
      new Map([
        ['./pages/Home', 'src/pages/Home.tsx'],
        ['./pages/Gold', 'src/pages/Gold.tsx'],
      ]),
    ).code;
    expect(out).toContain(`import { __ssrkModule } from 'ssr-kit';`);
    expect(out).toContain(`__ssrkModule(() => import('./pages/Gold'), "src/pages/Gold.tsx")`);
  });

  it('리터럴이 아니거나 화살표 함수 밖의 import() 는 에러', () => {
    expect(() =>
      scanRoutesFile('r.ts', `const p = './x'; export default [{ module: () => import(p) }];`),
    ).toThrow(/리터럴/);
    expect(() =>
      scanRoutesFile('r.ts', `export default [{ module: () => { return import('./x'); } }];`),
    ).toThrow(/형태/);
  });
});
