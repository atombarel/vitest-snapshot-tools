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

function staticCallTitle(content: string, open: number): string | undefined {
  let index = open + 1;
  while (/\s/.test(content[index] ?? "")) index += 1;
  const quote = content[index];
  if (quote !== '"' && quote !== "'" && quote !== "`") return undefined;
  let title = "";
  for (index += 1; index < content.length; index += 1) {
    const character = content[index];
    if (character === "\\") {
      const escaped = content[index + 1];
      if (escaped === undefined) return undefined;
      title += escaped;
      index += 1;
      continue;
    }
    if (quote === "`" && character === "$" && content[index + 1] === "{")
      return undefined;
    if (character === quote) return title.replace(/\s+/g, " ").trim();
    title += character;
  }
  return undefined;
}

function expectedTestName(context: SourceContext): string | undefined {
  const withoutOrdinal = context.snapshotKey.replace(/ \d+$/, "");
  let name = context.test?.name ?? withoutOrdinal;
  if (context.snapshotName && name.endsWith(` > ${context.snapshotName}`))
    name = name.slice(0, -(context.snapshotName.length + 3));
  return name.replace(/\s+/g, " ").trim() || undefined;
}

function sourceTestPath(
  content: string,
  test: CallOccurrence,
  structure: ReturnType<typeof scanSourceStructure>,
): string | undefined {
  const testTitle = staticCallTitle(content, test.open);
  if (!testTitle) return undefined;
  const testScope = scopeAt(structure.braces, test.offset);
  const suites = occurrences(
    content,
    /\bdescribe(?:\.(?:only|skip|todo|each))?\s*\(/g,
    structure.code,
  )
    .filter((suite) => {
      const end = callEndOffset(content, suite.open);
      return (
        end !== undefined &&
        structure.braces.some(
          (brace) =>
            brace.start > suite.open &&
            brace.start < end &&
            testScope.includes(brace.start),
        )
      );
    })
    .sort((left, right) => left.offset - right.offset)
    .map((suite) => staticCallTitle(content, suite.open))
    .filter((title): title is string => Boolean(title));
  return [...suites, testTitle].join(" > ");
}

function inferredTest(
  content: string,
  context: SourceContext,
  tests: CallOccurrence[],
  structure: ReturnType<typeof scanSourceStructure>,
): CallOccurrence | undefined {
  const reportedLine = context.test?.location?.line;
  const reported = reportedLine
    ? tests.find((test) => test.line === reportedLine)
    : undefined;
  if (reported) return reported;

  const expected = expectedTestName(context);
  if (!expected) return undefined;
  return tests.find((test) => {
    const path = sourceTestPath(content, test, structure);
    return (
      path === expected || Boolean(path && expected.endsWith(` > ${path}`))
    );
  });
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
  code: Uint8Array,
): MatcherOccurrence[] {
  const expression = new RegExp(`\\.\\s*${matcher}\\s*\\(`, "g");
  return [...content.matchAll(expression)]
    .filter((match) => code[match.index ?? 0] === 1)
    .map((match) => {
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
  code: Uint8Array,
): MatcherOccurrence | undefined {
  const occurrences = matcherOccurrences(content, context.matcher, code);
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
  const suites = occurrences(
    content,
    /\bdescribe(?:\.(?:only|skip|todo|each))?\s*\(/g,
    structure.code,
  )
    .flatMap((suite) => {
      const end = callEndOffset(content, suite.open);
      if (end === undefined) return [];
      const body = structure.braces
        .filter(
          (brace) =>
            brace.start > suite.open &&
            brace.start < end &&
            testScope.includes(brace.start),
        )
        .sort((left, right) => left.start - right.start)[0];
      if (!body) return [];
      return [
        {
          offset: suite.offset,
          block: blockFromLines(
            content,
            "suite",
            suite.line,
            lineAt(content, body.start),
          ),
        },
      ];
    })
    .sort((left, right) => left.offset - right.offset)
    .map((suite) => suite.block);
  const hooks = [
    ...content.matchAll(/\b(beforeAll|beforeEach|afterEach|afterAll)\s*\(/g),
  ].flatMap((match) => {
    const offset = match.index ?? 0;
    if (structure.code[offset] !== 1) return [];
    const kind = match[1] as
      | "beforeAll"
      | "beforeEach"
      | "afterEach"
      | "afterAll";
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
  });
  const before = hooks
    .filter((hook) => hook.kind === "beforeAll" || hook.kind === "beforeEach")
    .sort(
      (left, right) =>
        left.scopeDepth - right.scopeDepth || left.offset - right.offset,
    )
    .map((hook) => hook.block);
  const after = hooks
    .filter((hook) => hook.kind === "afterEach" || hook.kind === "afterAll")
    .sort(
      (left, right) =>
        right.scopeDepth - left.scopeDepth || left.offset - right.offset,
    )
    .map((hook) => hook.block);
  return [
    ...suites,
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
  const structure = scanSourceStructure(content);
  const tests = testOccurrences(content, structure.code);
  let test = inferredTest(content, context, tests, structure);
  let testLine = test?.line;
  const matcher = chooseMatcher(content, context, testLine, structure.code);
  // Historical sessions may have a file association but no test name or
  // location. In that case, use the matcher to find the enclosing test.
  if (!test && matcher) {
    test = tests
      .map((occurrence) => ({
        occurrence,
        end: callEndOffset(content, occurrence.open),
      }))
      .filter(
        (candidate) =>
          candidate.end !== undefined &&
          candidate.occurrence.line <= matcher.line &&
          lineAt(content, candidate.end) >= matcher.line,
      )
      .at(-1)?.occurrence;
    if (test) testLine = test.line;
  }
  const anchor = testLine ?? matcher?.line ?? 1;
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
