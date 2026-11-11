import MagicString from 'magic-string';

import { type AstNode, collectReferences, nameOf, parse, type Reference } from './ast';

/** 클라 번들에서 지울 서버 전용 export */
const SERVER_EXPORTS = ['loader', 'action', 'middleware'];
/** 이걸 지웠으면 이동 때 서버 데이터 요청이 필요하다 (로더 실행·미들웨어 실행) */
const DATA_EXPORTS = ['loader', 'middleware'];
const LOADER_MARKER = '\nexport const __ssrkLoader = true;\n';

type Range = [number, number];

interface Candidate {
  names: string[];
  range: Range;
}

const inRanges = (pos: number, ranges: Range[]) => ranges.some(([s, e]) => pos >= s && pos < e);

/** 선언 패턴(구조분해 포함)이 만드는 바인딩 이름 */
const bindingNames = (node: AstNode | null | undefined): string[] => {
  if (!node) return [];
  switch (node.type) {
    case 'Identifier':
      return [nameOf(node)!];
    case 'ObjectPattern':
      return (node.properties as AstNode[]).flatMap((p) =>
        bindingNames((p.type === 'RestElement' ? p.argument : p.value) as AstNode),
      );
    case 'ArrayPattern':
      return (node.elements as (AstNode | null)[]).flatMap((e) => bindingNames(e));
    case 'RestElement':
      return bindingNames(node.argument as AstNode);
    case 'AssignmentPattern':
      return bindingNames(node.left as AstNode);
    default:
      return [];
  }
};

/**
 * export 안 된 최상위 선언 (함수·클래스·변수, 부작용 있는 초기값 포함).
 * 로더를 지운 뒤 참조가 사라진 것만 지우므로(removeDeadHelpers), 원래 안 쓰이던 부작용 코드는 남는다.
 */
const findCandidates = (body: AstNode[]): Candidate[] => {
  const list: Candidate[] = [];
  for (const stmt of body) {
    const range: Range = [stmt.start, stmt.end];
    if ((stmt.type === 'FunctionDeclaration' || stmt.type === 'ClassDeclaration') && stmt.id) {
      list.push({ names: [nameOf(stmt.id as AstNode)!], range });
    }
    if (stmt.type === 'VariableDeclaration') {
      const names = (stmt.declarations as AstNode[]).flatMap((d) => bindingNames(d.id as AstNode));
      if (names.length) list.push({ names, range });
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

const isServerExport = (name: string | undefined) =>
  name !== undefined && SERVER_EXPORTS.includes(name);

/** 서버 전용 export 를 찾아 지운다. 지운 이름 목록을 돌려준다 */
const removeServerExports = (code: string, body: AstNode[], s: MagicString, removed: Range[]) => {
  const found = new Set<string>();
  for (const stmt of body) {
    if (stmt.type !== 'ExportNamedDeclaration') continue;
    const declaration = stmt.declaration as AstNode | null;

    const functionName =
      declaration?.type === 'FunctionDeclaration' ? nameOf(declaration.id as AstNode) : undefined;
    if (isServerExport(functionName)) {
      s.remove(stmt.start, stmt.end);
      removed.push([stmt.start, stmt.end]);
      found.add(functionName!);
    }
    if (declaration?.type === 'VariableDeclaration') {
      const declarations = declaration.declarations as AstNode[];
      const hit = declarations
        .map((d) => nameOf(d.id as AstNode))
        .find((name) => isServerExport(name));
      if (!hit) continue;
      if (declarations.length > 1) {
        throw new Error(`'export const ${hit}' must be declared separately from other declarations`);
      }
      s.remove(stmt.start, stmt.end);
      removed.push([stmt.start, stmt.end]);
      found.add(hit);
    }
    if (!declaration) {
      const specifiers = stmt.specifiers as AstNode[];
      const kept = specifiers.filter((spec) => !isServerExport(exportedName(spec)));
      if (kept.length === specifiers.length) continue;
      for (const spec of specifiers) if (!kept.includes(spec)) found.add(exportedName(spec)!);
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
  // 로더를 지우기 전부터 안 쓰이던 선언은 사용자 의도(부작용 등)일 수 있어 건드리지 않는다
  const candidates = findCandidates(body).filter((c) => isReferenced(c.names, refs, [], c.range));
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

/** 클라이언트 번들용: loader·action·middleware export 와 그 전용 코드·import 제거 */
export const stripServerExports = (id: string, code: string) => {
  if (!SERVER_EXPORTS.some((name) => code.includes(name))) return null;
  const program = parse(id, code);
  const s = new MagicString(code);
  const removed: Range[] = [];

  const found = removeServerExports(code, program.body, s, removed);
  if (found.size === 0) return null;

  const refs = collectReferences(program);
  removeDeadHelpers(program.body, refs, s, removed);
  removeUnusedImports(code, program.body, refs, s, removed);
  // 클라 라우터는 이 표시로 데이터 요청 여부를 정한다. action 만 있으면 필요 없다
  if (DATA_EXPORTS.some((name) => found.has(name))) s.append(LOADER_MARKER);

  return {
    code: s.toString(),
    map: s.generateMap({ hires: 'boundary', source: id, includeContent: true }),
  };
};
