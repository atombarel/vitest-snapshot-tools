import { basename, extname } from "node:path";
import type { EntryDiff, TestSource } from "@vsnap/protocol";

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

function testDeclarationLines(content: string): number[] {
  const lines = content.split("\n");
  const declarations: number[] = [];
  for (let index = 0; index < lines.length; index += 1)
    if (
      /\b(?:it|test)(?:\.(?:only|skip|todo|fails|concurrent|each))?\s*\(/.test(
        lines[index] ?? "",
      )
    )
      declarations.push(index + 1);
  return declarations;
}

function testEndLine(content: string, testLine: number): number | undefined {
  const lines = content.split("\n");
  const lineOffset = lines
    .slice(0, testLine - 1)
    .reduce((total, line) => total + line.length + 1, 0);
  const declaration = lines[testLine - 1] ?? "";
  const match =
    /\b(?:it|test)(?:\.(?:only|skip|todo|fails|concurrent|each))?\s*\(/.exec(
      declaration,
    );
  if (!match) return undefined;
  const open = content.indexOf("(", lineOffset + match.index);
  if (open < 0) return undefined;

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
    if (depth === 0) return lineAt(content, index);
  }
  return undefined;
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

export function locateTestSource(
  content: string,
  relativePath: string,
  context: SourceContext,
): Pick<TestSource, "language" | "focus"> {
  const lines = content.split("\n");
  const lineCount = content.endsWith("\n") ? lines.length - 1 : lines.length;
  const testLine = inferredTestLine(content, context);
  const matcher = chooseMatcher(content, context, testLine);
  const anchor = testLine ?? matcher?.line ?? 1;
  const endLine = Math.min(
    lineCount,
    testLine ? (testEndLine(content, testLine) ?? anchor) : anchor,
  );
  return {
    language: sourceLanguage(relativePath),
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
