import MagicString from 'magic-string';

import { type AstNode, parse, walk } from './ast';

export interface RouteImport {
  /** import('…') 문자열 */
  source: string;
  /** `() => import('…')` 화살표 함수 범위 */
  start: number;
  end: number;
}

export interface RoutesFileInfo {
  imports: RouteImport[];
  hasDefaultExport: boolean;
  hasRoutesExport: boolean;
}

const isLiteralImport = (node: AstNode | undefined) =>
  node?.type === 'ImportExpression' && (node.source as AstNode).type === 'Literal';

/** routes 파일에서 `() => import('리터럴')` 과 export 형태를 찾는다 */
export const scanRoutesFile = (id: string, code: string): RoutesFileInfo => {
  const program = parse(id, code);
  const imports: RouteImport[] = [];

  walk(program, (node, parent) => {
    if (node.type !== 'ImportExpression') return;
    const source = node.source as AstNode;
    if (source.type !== 'Literal') {
      throw new Error(`${id}: route module must be import('<string literal>')`);
    }
    if (parent?.type !== 'ArrowFunctionExpression' || !isLiteralImport(parent.body as AstNode)) {
      throw new Error(`${id}: import('${source.value}') must be wrapped as () => import('…')`);
    }
    imports.push({ source: source.value as string, start: parent.start, end: parent.end });
  });

  let hasDefaultExport = false;
  let hasRoutesExport = false;
  for (const stmt of program.body) {
    if (stmt.type === 'ExportDefaultDeclaration') hasDefaultExport = true;
    if (stmt.type !== 'ExportNamedDeclaration') continue;
    const declaration = stmt.declaration as AstNode | null;
    const declared = (declaration?.declarations as AstNode[] | undefined) ?? [];
    const specifiers = (stmt.specifiers as AstNode[]) ?? [];
    if (
      declared.some((d) => (d.id as AstNode).name === 'routes') ||
      specifiers.some((s) => (s.exported as AstNode).name === 'routes')
    ) {
      hasRoutesExport = true;
    }
  }
  return { imports, hasDefaultExport, hasRoutesExport };
};

/** `() => import('./x')` → `__ssrkModule(() => import('./x'), 'src/x.tsx')` */
export const annotateRoutesFile = (
  code: string,
  imports: RouteImport[],
  keys: Map<string, string>,
) => {
  const s = new MagicString(code);
  for (const item of imports) {
    const key = keys.get(item.source);
    if (!key) continue;
    s.prependLeft(item.start, '__ssrkModule(');
    s.appendRight(item.end, `, ${JSON.stringify(key)})`);
  }
  s.prepend(`import { __ssrkModule } from 'ssr-kit';\n`);
  return { code: s.toString(), map: s.generateMap({ hires: 'boundary', includeContent: true }) };
};
