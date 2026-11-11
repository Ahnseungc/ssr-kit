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

  it('로더만 쓰던 클래스·부작용 초기값·구조분해 선언과 그 import 를 지운다', () => {
    const out = strip(`
import { Pool } from 'pg';
import { secrets } from './secrets.server';
const pool = new Pool({ password: process.env.DB_PASSWORD });
const { apiKey } = secrets;
class Repo { find() { return pool.query(apiKey); } }
export const loader = () => new Repo().find();
export default () => null;
`);
    expect(out).not.toContain('pg');
    expect(out).not.toContain('DB_PASSWORD');
    expect(out).not.toContain('secrets');
    expect(out).not.toContain('Repo');
  });

  it('원래부터 안 쓰이던 부작용 선언과 다른 곳에서 쓰는 선언은 남긴다', () => {
    const out = strip(`
import { register } from './registry';
const registered = register('page');
const shared = { label: '공용' };
export const loader = () => shared;
export default () => shared.label;
`);
    expect(out).toContain(`const registered = register('page');`);
    expect(out).toContain('const shared');
  });

  it('loader 가 없으면 변환하지 않는다', () => {
    expect(strip(`export const head = () => ({}); export default () => null;`)).toBeNull();
    expect(strip(`const loaderText = 'loader'; export default () => loaderText;`)).toBeNull();
  });

  it('action 과 그 전용 헬퍼·import 를 지운다. action 만 있으면 로더 표시를 붙이지 않는다', () => {
    const out = strip(`
import { Form, useActionData } from 'ssr-kit';
import { saveMemo } from './memo.server';
import { z } from 'zod';
const schema = z.object({ text: z.string() });
export async function action({ request }) {
  const input = schema.parse(Object.fromEntries(await request.formData()));
  return saveMemo(input);
}
export default function Page() { const data = useActionData(); return <Form method="post">{data}</Form>; }
`);
    expect(out).not.toContain('memo.server');
    expect(out).not.toContain('zod');
    expect(out).not.toContain('schema');
    expect(out).not.toMatch(/function action/);
    expect(out).toContain(`import { Form, useActionData } from 'ssr-kit';`);
    expect(out).not.toContain('__ssrkLoader');
  });

  it('loader 와 action 을 함께 지우고(지정자 export 포함) 로더 표시를 남긴다', () => {
    const out = strip(`
import { db } from './db.server';
const loader = () => db.list();
const action = () => db.insert();
export { loader, action as action };
export const head = () => ({});
export default () => null;
`);
    expect(out).not.toContain('db');
    expect(out).not.toMatch(/export \{/);
    expect(out).toContain('export const head');
    expect(out).toContain('export const __ssrkLoader = true;');
  });

  it('여러 선언이 섞인 export const action 도 에러', () => {
    expect(() => strip(`export const action = () => 1, other = 2;`)).toThrow(/action.*separately/);
  });

  it('여러 선언이 섞인 export const loader 는 에러', () => {
    expect(() => strip(`export const loader = () => 1, other = 2;`)).toThrow(/separately/);
  });

  it('export const middleware (배열 포함) 와 미들웨어 전용 헬퍼·import 를 지우고 표시를 남긴다', () => {
    const out = strip(`
import { getSession } from './session.server';
import { redirect } from 'ssr-kit';
const requireUser = async ({ request }) => {
  if (!(await getSession(request))) redirect('/login');
};
const log = () => {};
export const middleware = [requireUser, log];
export default function Page() { return null; }
`);
    expect(out).not.toContain('session.server');
    expect(out).not.toContain('requireUser');
    expect(out).not.toContain('ssr-kit');
    expect(out).not.toMatch(/export const middleware/);
    expect(out).toContain('export const __ssrkLoader = true;');
  });

  it('loader·middleware 를 함께 지우고, export { middleware } 지정자도 지운다', () => {
    const out = strip(`
import { db } from './db.server';
import { auth } from './auth.server';
function middleware() { return auth(); }
export const loader = () => db.all();
export { middleware };
export const head = () => ({});
export default () => null;
`);
    expect(out).not.toContain('db');
    expect(out).not.toContain('auth');
    expect(out).not.toContain('function middleware');
    expect(out).toContain('export const head');
  });

  it('export function middleware 도 지운다', () => {
    const out = strip(`
export async function middleware(_args, next) { await next(); }
export default () => null;
`);
    expect(out).not.toContain('function middleware');
    expect(out).toContain('__ssrkLoader');
  });

  it('middleware 를 다른 선언과 한 문장에 쓰면 에러', () => {
    expect(() => strip(`export const a = 1, middleware = () => {};`)).toThrow(
      /export const middleware/,
    );
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
    ).toThrow(/string literal/);
    expect(() =>
      scanRoutesFile('r.ts', `export default [{ module: () => { return import('./x'); } }];`),
    ).toThrow(/must be wrapped/);
  });
});
