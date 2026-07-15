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

function callChainEndOffset(content: string, open: number): number | undefined {
  let end = callEndOffset(content, open);
  if (end === undefined) return undefined;
  while (end < content.length) {
    let next = end + 1;
    while (/\s/.test(content[next] ?? "")) next += 1;
    if (content[next] !== "(") return end;
    const chainedEnd = callEndOffset(content, next);
    if (chainedEnd === undefined) return end;
    end = chainedEnd;
  }
  return end;
}

function nextCodeCharacter(
  content: string,
  code: Uint8Array,
  offset: number,
  character: string,
): number {
  for (let index = offset; index < content.length; index += 1) {
    if (code[index] === 1 && content[index] === character) return index;
  }
  return -1;
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
        open: nextCodeCharacter(content, code, offset, "("),
      };
    })
    .filter((item) => item.open >= 0);
}

function testOccurrences(content: string, code: Uint8Array): CallOccurrence[] {
  return occurrences(
    content,
    /(?<![.$\w])(?:it|test)(?:\.(?:only|skip|todo|fails|concurrent|sequential|each))*\s*(?=[(`])/g,
    code,
  );
}

function suiteOccurrences(content: string, code: Uint8Array): CallOccurrence[] {
  return occurrences(
    content,
    /(?<![.$\w])describe(?:\.(?:only|skip|todo|concurrent|sequential|shuffle|each))*\s*(?=[(`])/g,
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

function occurrenceTitle(
  content: string,
  occurrence: CallOccurrence,
): string | undefined {
  const prefix = content.slice(occurrence.offset, occurrence.open);
  if (!prefix.includes(".each"))
    return staticCallTitle(content, occurrence.open);
  const tableEnd = callEndOffset(content, occurrence.open);
  if (tableEnd === undefined) return undefined;
  let titleOpen = tableEnd + 1;
  while (/\s/.test(content[titleOpen] ?? "")) titleOpen += 1;
  return content[titleOpen] === "("
    ? staticCallTitle(content, titleOpen)
    : staticCallTitle(content, occurrence.open);
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
  const testTitle = occurrenceTitle(content, test);
  if (!testTitle) return undefined;
  const testScope = scopeAt(structure.braces, test.offset);
  const suites = suiteOccurrences(content, structure.code)
    .filter((suite) => {
      const end = callChainEndOffset(content, suite.open);
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
    .map((suite) => occurrenceTitle(content, suite))
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
  const registration = reportedRegistration(content, context, structure);
  if (registration) return registration;

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
  offset: number;
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
        offset,
        line: lineAt(content, offset),
        column: offset - lineStart + 1,
        preview: matcherPreview(content, offset),
      };
    });
}

function occurrenceColumn(content: string, occurrence: CallOccurrence): number {
  return occurrence.offset - content.lastIndexOf("\n", occurrence.offset);
}

function runtimeSuiteOccurrences(
  content: string,
  context: SourceContext,
  suites: CallOccurrence[],
): CallOccurrence[] {
  const reported = context.test?.suites ?? [];
  const selected = reported.flatMap((suite) => {
    const location = suite.location;
    if (!location) return [];
    const containingLine = suites.filter((candidate) => {
      const end = callChainEndOffset(content, candidate.open);
      return (
        candidate.line <= location.line &&
        end !== undefined &&
        lineAt(content, end) >= location.line
      );
    });
    const match = containingLine.sort(
      (left, right) =>
        right.line - left.line ||
        Math.abs(occurrenceColumn(content, left) - location.column) -
          Math.abs(occurrenceColumn(content, right) - location.column),
    )[0];
    return match ? [match] : [];
  });
  return selected.filter(
    (suite, index) =>
      selected.findIndex((candidate) => candidate.offset === suite.offset) ===
      index,
  );
}

function chooseMatcher(
  content: string,
  context: SourceContext,
  test: CallOccurrence | undefined,
  runtimeSuites: CallOccurrence[],
  code: Uint8Array,
): MatcherOccurrence | undefined {
  const allOccurrences = matcherOccurrences(content, context.matcher, code);
  if (allOccurrences.length === 0) return undefined;
  let occurrences = allOccurrences;
  for (const suite of runtimeSuites) {
    const end = callChainEndOffset(content, suite.open);
    if (end === undefined) continue;
    const scoped = occurrences.filter(
      (item) => item.offset > suite.offset && item.offset < end,
    );
    if (scoped.length > 0) occurrences = scoped;
  }
  const testLine = test?.line;
  const declarations = testDeclarationLines(content);
  const nextTestLine = testLine
    ? declarations.find((line) => line > testLine)
    : undefined;
  const testEnd = test ? callChainEndOffset(content, test.open) : undefined;
  const insideTest =
    test && testEnd !== undefined
      ? occurrences.filter(
          (item) => item.offset > test.offset && item.offset < testEnd,
        )
      : [];
  const scoped =
    insideTest.length > 0
      ? insideTest
      : testLine
        ? occurrences.filter(
            (item) =>
              item.line >= testLine &&
              (!nextTestLine || item.line < nextTestLine),
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

function registrationContainingMatcher(
  content: string,
  matcher: MatcherOccurrence,
  context: SourceContext,
  structure: ReturnType<typeof scanSourceStructure>,
): CallOccurrence | undefined {
  const calls = registrationCalls(content, structure).filter((call) => {
    const name = content.slice(call.offset, call.open);
    if (/\b(?:describe|beforeAll|beforeEach|afterEach|afterAll)\b/.test(name))
      return false;
    const end = callChainEndOffset(content, call.open);
    if (
      end === undefined ||
      matcher.offset <= call.open ||
      matcher.offset >= end
    )
      return false;
    return structure.braces.some(
      (brace) =>
        brace.start > call.open &&
        brace.start < matcher.offset &&
        brace.end > matcher.offset &&
        brace.end < end,
    );
  });
  if (calls.length === 0) return undefined;
  const leafName = expectedTestName(context)?.split(" > ").at(-1);
  const titled = leafName
    ? calls.find((call) => occurrenceTitle(content, call) === leafName)
    : undefined;
  if (titled) return titled;
  return calls.sort((left, right) => left.offset - right.offset)[0];
}

function registrationCalls(
  content: string,
  structure: ReturnType<typeof scanSourceStructure>,
): CallOccurrence[] {
  return occurrences(
    content,
    /(?<![.$\w])[$A-Z_a-z][$\w]*(?:\s*\.\s*[$A-Z_a-z][$\w]*)*\s*(?=\()/g,
    structure.code,
  ).filter((call) => {
    const name = content.slice(call.offset, call.open);
    return !/\b(?:describe|beforeAll|beforeEach|afterEach|afterAll|expect|assert)\b/.test(
      name,
    );
  });
}

function reportedRegistration(
  content: string,
  context: SourceContext,
  structure: ReturnType<typeof scanSourceStructure>,
): CallOccurrence | undefined {
  const location = context.test?.location;
  if (!location) return undefined;
  if (
    matcherOccurrences(content, context.matcher, structure.code).some(
      (matcher) => matcher.line === location.line,
    )
  )
    return undefined;
  const lineStart =
    location.line <= 1
      ? 0
      : content.split("\n", location.line - 1).join("\n").length + 1;
  const locationOffset = lineStart + Math.max(0, location.column - 1);
  const calls = registrationCalls(content, structure);
  const sameLine = calls.filter((call) => call.line === location.line);
  const containing = calls.filter((call) => {
    const end = callChainEndOffset(content, call.open);
    return (
      end !== undefined &&
      call.offset <= locationOffset &&
      end >= locationOffset
    );
  });
  const candidates = sameLine.length > 0 ? sameLine : containing;
  if (candidates.length === 0) return undefined;
  const leafName = expectedTestName(context)?.split(" > ").at(-1);
  const titled = leafName
    ? candidates.find((call) => occurrenceTitle(content, call) === leafName)
    : undefined;
  if (titled) return titled;
  return candidates.sort(
    (left, right) =>
      Math.abs(occurrenceColumn(content, left) - location.column) -
      Math.abs(occurrenceColumn(content, right) - location.column),
  )[0];
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
  runtimeSuites: CallOccurrence[],
): TestSourceBlock[] {
  if (!test) return [];
  const testEnd = callChainEndOffset(content, test.open);
  if (testEnd === undefined) return [];
  const testScope = scopeAt(structure.braces, test.offset);
  const lexicalSuites = suiteOccurrences(content, structure.code)
    .flatMap((suite) => {
      const end = callChainEndOffset(content, suite.open);
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
          end,
          block: blockFromLines(
            content,
            "suite",
            suite.line,
            lineAt(content, body.start),
          ),
        },
      ];
    })
    .sort((left, right) => left.offset - right.offset);
  const reportedSuites = runtimeSuites.flatMap((suite) => {
    const end = callChainEndOffset(content, suite.open);
    if (end === undefined) return [];
    const body = structure.braces
      .filter(
        (brace) =>
          brace.start > suite.open &&
          brace.start < test.offset &&
          brace.end > test.offset &&
          brace.end < end,
      )
      .sort((left, right) => left.start - right.start)[0];
    return [
      {
        offset: suite.offset,
        end,
        block: blockFromLines(
          content,
          "suite",
          suite.line,
          lineAt(content, body?.start ?? end),
        ),
      },
    ];
  });
  const suiteItems = reportedSuites.length > 0 ? reportedSuites : lexicalSuites;
  const innermostSuite = suiteItems.at(-1);
  const fullInnermostSuite = Boolean(
    innermostSuite &&
      innermostSuite.offset < test.offset &&
      innermostSuite.end > testEnd,
  );
  const suites = suiteItems.map((suite, index) =>
    fullInnermostSuite && index === suiteItems.length - 1
      ? blockFromLines(
          content,
          "suite",
          suite.block.startLine,
          lineAt(content, suite.end),
        )
      : suite.block,
  );
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
    .filter(
      (hook) =>
        !fullInnermostSuite ||
        !innermostSuite ||
        hook.offset < innermostSuite.offset ||
        hook.offset > innermostSuite.end,
    )
    .sort(
      (left, right) =>
        left.scopeDepth - right.scopeDepth || left.offset - right.offset,
    )
    .map((hook) => hook.block);
  const after = hooks
    .filter((hook) => hook.kind === "afterEach" || hook.kind === "afterAll")
    .filter(
      (hook) =>
        !fullInnermostSuite ||
        !innermostSuite ||
        hook.offset < innermostSuite.offset ||
        hook.offset > innermostSuite.end,
    )
    .sort(
      (left, right) =>
        right.scopeDepth - left.scopeDepth || left.offset - right.offset,
    )
    .map((hook) => hook.block);
  return [
    ...suites,
    ...before,
    ...(fullInnermostSuite
      ? []
      : [blockFromLines(content, "test", test.line, lineAt(content, testEnd))]),
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
  const suites = suiteOccurrences(content, structure.code);
  const runtimeSuites = runtimeSuiteOccurrences(content, context, suites);
  let test = inferredTest(content, context, tests, structure);
  let testLine = test?.line;
  const matcher = chooseMatcher(
    content,
    context,
    test,
    runtimeSuites,
    structure.code,
  );
  if (matcher) {
    const testEnd = test ? callChainEndOffset(content, test.open) : undefined;
    if (
      !test ||
      testEnd === undefined ||
      matcher.offset < test.offset ||
      matcher.offset > testEnd
    ) {
      test = registrationContainingMatcher(
        content,
        matcher,
        context,
        structure,
      );
      if (test) testLine = test.line;
    }
  }
  // Historical sessions may have a file association but no test name or
  // location. In that case, use the matcher to find the enclosing test.
  if (!test && matcher) {
    test = tests
      .map((occurrence) => ({
        occurrence,
        end: callChainEndOffset(content, occurrence.open),
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
      ? lineAt(content, callChainEndOffset(content, test.open) ?? test.offset)
      : anchor,
  );
  return {
    language: sourceLanguage(relativePath),
    blocks: linkedSourceBlocks(content, test, structure, runtimeSuites),
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
