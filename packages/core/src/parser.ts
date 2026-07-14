import { parse } from "acorn";
import { sha256, stableId } from "./hash.js";

interface AstNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}
interface TemplateNode extends AstNode {
  expressions: AstNode[];
  quasis: Array<{ value: { cooked: string | null; raw: string } }>;
}

export interface ParsedSnapshotEntry {
  key: string;
  value: string;
  testName: string;
  ordinal?: number;
  assignmentStart: number;
  assignmentEnd: number;
  raw: string;
}

export interface ParsedSnapshotFile {
  parseMode: "entries" | "opaque";
  source: string;
  entries: ParsedSnapshotEntry[];
  error?: string;
}

function asNode(value: unknown): AstNode | null {
  if (
    !value ||
    typeof value !== "object" ||
    !("type" in value) ||
    typeof value.type !== "string"
  )
    return null;
  return value as AstNode;
}

function staticTemplate(node: unknown): string | null {
  const value = asNode(node) as TemplateNode | null;
  if (
    !value ||
    value.type !== "TemplateLiteral" ||
    value.expressions.length !== 0 ||
    value.quasis.length !== 1
  )
    return null;
  return value.quasis[0]?.value.cooked ?? null;
}

function parseAssignment(
  node: AstNode,
  source: string,
): ParsedSnapshotEntry | null {
  if (node.type !== "ExpressionStatement") return null;
  const expression = asNode(node.expression);
  if (
    !expression ||
    expression.type !== "AssignmentExpression" ||
    expression.operator !== "="
  )
    return null;
  const left = asNode(expression.left);
  if (!left || left.type !== "MemberExpression" || left.computed !== true)
    return null;
  const object = asNode(left.object);
  if (!object || object.type !== "Identifier" || object.name !== "exports")
    return null;
  const key = staticTemplate(left.property);
  const value = staticTemplate(expression.right);
  if (key === null || value === null) return null;
  const match = /^(.*) (\d+)$/.exec(key);
  const ordinal = match?.[2] ? Number(match[2]) : undefined;
  return {
    key,
    value,
    testName: match?.[1] ?? key,
    ...(ordinal === undefined ? {} : { ordinal }),
    assignmentStart: node.start,
    assignmentEnd: node.end,
    raw: source.slice(node.start, node.end),
  };
}

/** Parse a Vitest snapshot module without evaluating any source. Unsafe shapes become opaque. */
export function parseSnapshotFile(source: string): ParsedSnapshotFile {
  try {
    const program = parse(source, {
      ecmaVersion: "latest",
      sourceType: "script",
      ranges: true,
    }) as unknown as { body: AstNode[] };
    const entries: ParsedSnapshotEntry[] = [];
    for (const node of program.body) {
      const entry = parseAssignment(node, source);
      if (!entry)
        return {
          parseMode: "opaque",
          source,
          entries: [],
          error: `Unsupported statement: ${node.type}`,
        };
      entries.push(entry);
    }
    if (
      entries.length === 0 &&
      source.trim().length > 0 &&
      !/^\s*(?:\/\/[^\n]*\s*|\/\*[\s\S]*?\*\/\s*)*$/.test(source)
    ) {
      return {
        parseMode: "opaque",
        source,
        entries: [],
        error: "No static snapshot assignments found",
      };
    }
    return { parseMode: "entries", source, entries };
  } catch (error) {
    return {
      parseMode: "opaque",
      source,
      entries: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function escapeSnapshotValue(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\r\n", "\\r\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("`", "\\`")
    .replaceAll("${", "\\${");
}

export function serializeSnapshotEntry(key: string, value: string): string {
  return `exports[\`${escapeSnapshotValue(key)}\`] = \`${escapeSnapshotValue(value)}\`;`;
}

export function snapshotFileId(relativePath: string): string {
  return stableId("file", relativePath);
}
export function snapshotEntryId(relativePath: string, key: string): string {
  return stableId("entry", relativePath, key);
}
export function blobHash(content: string): string {
  return sha256(content);
}
