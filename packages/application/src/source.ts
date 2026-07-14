import { basename, extname } from "node:path";
import type { EntryDiff, TestSource, TestSourceBlock } from "@vsnap/protocol";

type SourceContext = EntryDiff["context"];

function lineAt(content: string, offset: number): number {
  return content.slice(0, offset).split("\n").length;
}

function sourceLanguage(path: string): TestSource["language"] {
  switch (extname(path).toLowerCase()) {
    case ".ts":
    case ".mts":
    case ".cts":
      return "typescript";
    case ".tsx":
      return "tsx";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".jsx":
      return "jsx";
    default:
      return "text";
  }
}

interface CallOccurrence {
  offset: number;
  line: number;
  open: number;
}

interface BraceRange {
  start: number;
  end: number;
}

function scanSourceStructure(content: string): {
  code: Uint8Array;
  braces: BraceRange[];
} {
  const code = new Uint8Array(content.length);
  const braces: BraceRange[] = [];
  const braceStack: number[] = [];
  let quote: '"' | "'" | "`" | undefined;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    const next = content[index + 1];
    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote) {
      if (character === "\\") escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    code[index] = 1;
    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") braceStack.push(index);
    if (character === "}") {
      const start = braceStack.pop();
      if (start !== undefined) braces.push({ start, end: index });
    }
  }
  return { code, braces };
}

function callEndOffset(content: string, open: number): number | undefined {
  let depth = 0;
  let quote: '"' | "'" | "`" | undefined;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = open; index < content.length; index += 1) {
    const character = content[index];
    const next = content[index + 1];
    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote) {
      if (character === "\\") escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "(") depth += 1;
    if (character !== ")") continue;
    depth -= 1;
    if (depth === 0) return index;
  }
  return undefined;
}

function occurrences(
  content: string,
  expression: RegExp,
  code: Uint8Array,
): CallOccurrence[] {
  return [...content.matchAll(expression)]
    .filter((match) => code[match.index ?? 0] === 1)
    .map((match) => {
      const offset = match.index ?? 0;
      return {
        offset,
        line: lineAt(content, offset),
        open: content.indexOf("(", offset),
      };
    })
    .filter((item) => item.open >= 0);
}

function testOccurrences(content: string, code: Uint8Array): CallOccurrence[] {
  return occurrences(
    content,
    /\b(?:it|test)(?:\.(?:only|skip|todo|fails|concurrent|each))?\s*\(/g,
    code,
  );
}

function testDeclarationLines(content: string): number[] {
  const { code } = scanSourceStructure(content);
  return testOccurrences(content, code).map((item) => item.line);
}

function inferredTestLine(
  content: string,
  context: SourceContext,
): number | undefined {
  if (context.test?.location?.line) return context.test.location.line;
  const leafName = context.test?.name?.split(" > ").at(-1);
  if (!leafName) return undefined;
  const lines = content.split("\n");
  const declarationLines = new Set(testDeclarationLines(content));
  const exact = lines.findIndex(
    (line, index) => declarationLines.has(index + 1) && line.includes(leafName),
  );
  if (exact >= 0) return exact + 1;
  const fallback = lines.findIndex((line) => line.includes(leafName));
  return fallback >= 0 ? fallback + 1 : undefined;
}

interface MatcherOccurrence {
  line: number;
  column: number;
  preview: string;
}

function matcherPreview(content: string, offset: number): string {
  const open = content.indexOf("(", offset);
  if (open < 0) return content.slice(offset, offset + 200);
  let depth = 0;
  let quote: '"' | "'" | "`" | undefined;
  let escaped = false;
  for (
    let index = open;
    index < Math.min(content.length, open + 1_000);
    index += 1
  ) {
    const character = content[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")") {
      depth -= 1;
      if (depth === 0) return content.slice(offset, index + 1);
    }
  }
  return content.slice(offset, offset + 1_000);
}

function matcherOccurrences(
  content: string,
  matcher: SourceContext["matcher"],
): MatcherOccurrence[] {
  const expression = new RegExp(`\\.\\s*${matcher}\\s*\\(`, "g");
  return [...content.matchAll(expression)].map((match) => {
    const offset = match.index ?? 0;
    const lineStart = content.lastIndexOf("\n", offset) + 1;
    return {
      line: lineAt(content, offset),
      column: offset - lineStart + 1,
      preview: matcherPreview(content, offset),
    };
  });
}

function chooseMatcher(
  content: string,
  context: SourceContext,
  testLine: number | undefined,
): MatcherOccurrence | undefined {
  const occurrences = matcherOccurrences(content, context.matcher);
  if (occurrences.length === 0) return undefined;
  const declarations = testDeclarationLines(content);
  const nextTestLine = testLine
    ? declarations.find((line) => line > testLine)
    : undefined;
  const scoped = testLine
    ? occurrences.filter(
        (item) =>
          item.line >= testLine && (!nextTestLine || item.line < nextTestLine),
      )
    : occurrences;
  const candidates = scoped.length > 0 ? scoped : occurrences;
  const snapshotName = context.snapshotName;
  if (snapshotName) {
    const exactName = candidates.find(
      (item) =>
        item.preview.includes(JSON.stringify(snapshotName)) ||
        item.preview.includes(`'${snapshotName.replaceAll("'", "\\'")}'`) ||
        (context.matcher === "toMatchFileSnapshot" &&
          item.preview.includes(basename(snapshotName))),
    );
    if (exactName) return exactName;
  }
  if (context.matcher === "toMatchFileSnapshot") {
    const targetName = basename(context.snapshotFile);
    const target = candidates.find((item) => item.preview.includes(targetName));
    if (target) return target;
  }
  if (context.ordinal && candidates[context.ordinal - 1])
    return candidates[context.ordinal - 1];
  return candidates[0];
}

function blockFromLines(
  content: string,
  kind: TestSourceBlock["kind"],
  startLine: number,
  endLine: number,
): TestSourceBlock {
  return {
    kind,
    content: content
      .split("\n")
      .slice(startLine - 1, endLine)
      .join("\n"),
    startLine,
    endLine,
  };
}

function scopeAt(braces: BraceRange[], offset: number): number[] {
  return braces
    .filter((brace) => brace.start < offset && brace.end > offset)
    .sort((left, right) => left.start - right.start)
    .map((brace) => brace.start);
}

function isParentScope(parent: number[], child: number[]): boolean {
  return (
    parent.length <= child.length &&
    parent.every((brace, index) => child[index] === brace)
  );
}

function linkedSourceBlocks(
  content: string,
  test: CallOccurrence | undefined,
  structure: ReturnType<typeof scanSourceStructure>,
): TestSourceBlock[] {
  if (!test) return [];
  const testEnd = callEndOffset(content, test.open);
  if (testEnd === undefined) return [];
  const testScope = scopeAt(structure.braces, test.offset);
  const hooks = [...content.matchAll(/\b(beforeEach|afterEach)\s*\(/g)].flatMap(
    (match) => {
      const offset = match.index ?? 0;
      if (structure.code[offset] !== 1) return [];
      const kind = match[1] as "beforeEach" | "afterEach";
      const open = content.indexOf("(", offset);
      if (open < 0) return [];
      const end = callEndOffset(content, open);
      if (end === undefined) return [];
      const scope = scopeAt(structure.braces, offset);
      if (!isParentScope(scope, testScope)) return [];
      return [
        {
          kind,
          offset,
          scopeDepth: scope.length,
          block: blockFromLines(
            content,
            kind,
            lineAt(content, offset),
            lineAt(content, end),
          ),
        },
      ];
    },
  );
  const before = hooks
    .filter((hook) => hook.kind === "beforeEach")
    .sort(
      (left, right) =>
        left.scopeDepth - right.scopeDepth || left.offset - right.offset,
    )
    .map((hook) => hook.block);
  const after = hooks
    .filter((hook) => hook.kind === "afterEach")
    .sort(
      (left, right) =>
        right.scopeDepth - left.scopeDepth || left.offset - right.offset,
    )
    .map((hook) => hook.block);
  return [
    ...before,
    blockFromLines(content, "test", test.line, lineAt(content, testEnd)),
    ...after,
  ];
}

export function locateTestSource(
  content: string,
  relativePath: string,
  context: SourceContext,
): Pick<TestSource, "language" | "focus" | "blocks"> {
  const lines = content.split("\n");
  const lineCount = content.endsWith("\n") ? lines.length - 1 : lines.length;
  const testLine = inferredTestLine(content, context);
  const matcher = chooseMatcher(content, context, testLine);
  const anchor = testLine ?? matcher?.line ?? 1;
  const structure = scanSourceStructure(content);
  const test = testOccurrences(content, structure.code).find(
    (occurrence) => occurrence.line === testLine,
  );
  const endLine = Math.min(
    lineCount,
    test
      ? lineAt(content, callEndOffset(content, test.open) ?? test.offset)
      : anchor,
  );
  return {
    language: sourceLanguage(relativePath),
    blocks: linkedSourceBlocks(content, test, structure),
    focus: {
      ...(testLine ? { testLine } : {}),
      ...(matcher
        ? {
            matcherLine: matcher.line,
            matcherLines: [matcher.line],
            matcherColumn: matcher.column,
          }
        : {}),
      startLine: Math.max(1, testLine ?? anchor),
      endLine: Math.max(anchor, endLine),
    },
  };
}
