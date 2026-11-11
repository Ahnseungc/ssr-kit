import { parseSync } from 'oxc-parser';

export interface AstNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

export const parse = (filename: string, code: string) => {
  const result = parseSync(filename, code);
  if (result.errors.length) {
    throw new Error(`${filename} 파싱 실패: ${result.errors[0]!.message}`);
  }
  return result.program as unknown as AstNode & { body: AstNode[] };
};

const isNode = (value: unknown): value is AstNode =>
  typeof value === 'object' && value !== null && typeof (value as AstNode).type === 'string';

type Visitor = (node: AstNode, parent: AstNode | null, key: string | null) => void;

export const walk = (
  node: AstNode,
  visit: Visitor,
  parent: AstNode | null = null,
  key: string | null = null,
) => {
  visit(node, parent, key);
  for (const [childKey, value] of Object.entries(node)) {
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) walk(item, visit, node, childKey);
    } else if (isNode(value)) {
      walk(value, visit, node, childKey);
    }
  }
};

const IMPORT_SPECIFIERS = new Set([
  'ImportSpecifier',
  'ImportDefaultSpecifier',
  'ImportNamespaceSpecifier',
]);

/** 식별자가 값 참조 위치가 아닌 경우 (속성 키, import 선언 등) */
const isNonReference = (parent: AstNode | null, key: string | null) => {
  if (!parent) return false;
  if (IMPORT_SPECIFIERS.has(parent.type)) return true;
  if (key === 'label') return true;
  if (
    (parent.type === 'MemberExpression' || parent.type === 'JSXMemberExpression') &&
    key === 'property'
  ) {
    return !parent.computed;
  }
  if (
    (parent.type === 'Property' ||
      parent.type === 'MethodDefinition' ||
      parent.type === 'PropertyDefinition') &&
    key === 'key'
  ) {
    return !parent.computed;
  }
  if (parent.type === 'ExportSpecifier' && key === 'exported') return true;
  if (parent.type === 'JSXAttribute' && key === 'name') return true;
  return false;
};

export interface Reference {
  name: string;
  start: number;
}

/** 값 참조 위치의 식별자 전부 (보수적: 섀도잉은 구분하지 않는다) */
export const collectReferences = (program: AstNode): Reference[] => {
  const refs: Reference[] = [];
  walk(program, (node, parent, key) => {
    if (node.type !== 'Identifier' && node.type !== 'JSXIdentifier') return;
    if (isNonReference(parent, key)) return;
    refs.push({ name: node.name as string, start: node.start });
  });
  return refs;
};

export const nameOf = (node: AstNode | undefined) =>
  (node?.name as string | undefined) ?? (node?.value as string | undefined);
