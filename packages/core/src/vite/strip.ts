import MagicString from 'magic-string';

import { type AstNode, collectReferences, nameOf, parse, type Reference } from './ast';

const SERVER_EXPORT = 'loader';
const LOADER_MARKER = '\nexport const __ssrkLoader = true;\n';

type Range = [number, number];

interface Candidate {
  names: string[];
  range: Range;
}

const inRanges = (pos: number, ranges: Range[]) => ranges.some(([s, e]) => pos >= s && pos < e);

const isFunctionValue = (node: AstNode | null | undefined) =>
  node?.type === 'ArrowFunctionExpression' || node?.type === 'FunctionExpression';

/** export 안 된 최상위 함수 선언·함수 값 변수 선언 (로더 전용 헬퍼 후보) */
const findCandidates = (body: AstNode[]): Candidate[] => {
  const list: Candidate[] = [];
  for (const stmt of body) {
    if (stmt.type === 'FunctionDeclaration' && stmt.id) {
      list.push({ names: [nameOf(stmt.id as AstNode)!], range: [stmt.start, stmt.end] });
    }
    if (stmt.type === 'VariableDeclaration') {
      const declarations = stmt.declarations as AstNode[];
      const allFunctions = declarations.every(
        (d) => (d.id as AstNode).type === 'Identifier' && isFunctionValue(d.init as AstNode),
      );
      if (allFunctions) {
        list.push({
          names: declarations.map((d) => nameOf(d.id as AstNode)!),
          range: [stmt.start, stmt.end],
        });
      }
    }
  }
  return list;
};

const exportedName = (spec: AstNode) => nameOf(spec.exported as AstNode);

const exportClause = (code: string, stmt: AstNode, specifiers: AstNode[]) => {
  const list = specifiers.map((s) => code.slice(s.start, s.end)).join(', ');
  const source = stmt.source
    ? ` from ${code.slice((stmt.source as AstNode).start, (stmt.source as AstNode).end)}`
    : '';
  return `export { ${list} }${source};`;
};

/** loader export 를 찾아 지운다. 지웠으면 true */
const removeLoaderExports = (code: string, body: AstNode[], s: MagicString, removed: Range[]) => {
  let found = false;
  for (const stmt of body) {
    if (stmt.type !== 'ExportNamedDeclaration') continue;
    const declaration = stmt.declaration as AstNode | null;

    if (
      declaration?.type === 'FunctionDeclaration' &&
      nameOf(declaration.id as AstNode) === SERVER_EXPORT
    ) {
      s.remove(stmt.start, stmt.end);
      removed.push([stmt.start, stmt.end]);
      found = true;
    }
    if (declaration?.type === 'VariableDeclaration') {
      const declarations = declaration.declarations as AstNode[];
      const hit = declarations.some((d) => nameOf(d.id as AstNode) === SERVER_EXPORT);
      if (!hit) continue;
      if (declarations.length > 1) {
        throw new Error(`'export const ${SERVER_EXPORT}' 는 다른 선언과 따로 써야 한다`);
      }
      s.remove(stmt.start, stmt.end);
      removed.push([stmt.start, stmt.end]);
      found = true;
    }
    if (!declaration) {
      const specifiers = stmt.specifiers as AstNode[];
      const kept = specifiers.filter((spec) => exportedName(spec) !== SERVER_EXPORT);
      if (kept.length === specifiers.length) continue;
      found = true;
      if (kept.length === 0) {
        s.remove(stmt.start, stmt.end);
        removed.push([stmt.start, stmt.end]);
      } else {
        s.overwrite(stmt.start, stmt.end, exportClause(code, stmt, kept));
        for (const spec of specifiers)
          if (!kept.includes(spec)) removed.push([spec.start, spec.end]);
      }
    }
  }
  return found;
};

const isReferenced = (names: string[], refs: Reference[], removed: Range[], own?: Range) =>
  refs.some(
    (ref) =>
      names.includes(ref.name) &&
      !inRanges(ref.start, removed) &&
      !(own && ref.start >= own[0] && ref.start < own[1]),
  );

const removeDeadHelpers = (
  body: AstNode[],
  refs: Reference[],
  s: MagicString,
  removed: Range[],
) => {
  const candidates = findCandidates(body);
  const dead = new Set<Candidate>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of candidates) {
      if (dead.has(candidate) || isReferenced(candidate.names, refs, removed, candidate.range))
        continue;
      dead.add(candidate);
      removed.push(candidate.range);
      s.remove(candidate.range[0], candidate.range[1]);
      changed = true;
    }
  }
};

const importClause = (code: string, stmt: AstNode, kept: AstNode[]) => {
  const source = code.slice((stmt.source as AstNode).start, (stmt.source as AstNode).end);
  const defaults = kept
    .filter((k) => k.type !== 'ImportSpecifier')
    .map((k) => code.slice(k.start, k.end));
  const named = kept
    .filter((k) => k.type === 'ImportSpecifier')
    .map((k) => code.slice(k.start, k.end));
  const parts = [...defaults, ...(named.length ? [`{ ${named.join(', ')} }`] : [])];
  return `import ${parts.join(', ')} from ${source};`;
};

const removeUnusedImports = (
  code: string,
  body: AstNode[],
  refs: Reference[],
  s: MagicString,
  removed: Range[],
) => {
  for (const stmt of body) {
    if (stmt.type !== 'ImportDeclaration') continue;
    const specifiers = stmt.specifiers as AstNode[];
    if (specifiers.length === 0) continue;
    const kept = specifiers.filter((spec) =>
      isReferenced([nameOf(spec.local as AstNode)!], refs, removed),
    );
    if (kept.length === specifiers.length) continue;
    if (kept.length === 0) s.remove(stmt.start, stmt.end);
    else s.overwrite(stmt.start, stmt.end, importClause(code, stmt, kept));
  }
};

/** 클라이언트 번들용: loader export 와 그 전용 코드·import 제거 */
export const stripServerExports = (id: string, code: string) => {
  if (!code.includes(SERVER_EXPORT)) return null;
  const program = parse(id, code);
  const s = new MagicString(code);
  const removed: Range[] = [];

  if (!removeLoaderExports(code, program.body, s, removed)) return null;

  const refs = collectReferences(program);
  removeDeadHelpers(program.body, refs, s, removed);
  removeUnusedImports(code, program.body, refs, s, removed);
  s.append(LOADER_MARKER);

  return {
    code: s.toString(),
    map: s.generateMap({ hires: 'boundary', source: id, includeContent: true }),
  };
};
