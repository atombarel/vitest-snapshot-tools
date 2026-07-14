import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const scenarioCount = 100;
const suiteName = "large API migration";
const sourceRoot = resolve("src");
const snapshotRoot = resolve(sourceRoot, "__snapshots__");

function scenarioName(index) {
  return `scenario ${String(index).padStart(3, "0")}`;
}

function valuesFor(index) {
  const scenario = `scenario-${String(index).padStart(3, "0")}`;
  const payload = { id: index, name: `Record ${index}` };
  if (index <= 40)
    return {
      candidate: {
        scenario,
        endpoint: "/v2/customers",
        apiVersion: "2026-07-14",
        payload,
      },
      baseline: { scenario, endpoint: "/v2/customers", payload },
    };
  if (index <= 65)
    return {
      candidate: {
        scenario,
        endpoint: "/v2/orders",
        state: "active",
        payload,
      },
      baseline: {
        scenario,
        endpoint: "/v2/orders",
        status: "active",
        payload,
      },
    };
  if (index <= 80)
    return {
      candidate: {
        scenario,
        endpoint: "/v2/invoices",
        currency: "EUR",
        payload,
      },
      baseline: {
        scenario,
        endpoint: "/v2/invoices",
        currency: "USD",
        payload,
      },
    };
  if (index <= 90)
    return {
      candidate: {
        scenario,
        endpoint: "/v2/permissions",
        features: ["read", "write", "audit"],
        payload,
      },
      baseline: {
        scenario,
        endpoint: "/v2/permissions",
        features: ["read", "write"],
        payload,
      },
    };
  if (index <= 95)
    return {
      candidate: {
        scenario,
        endpoint: "/v2/outliers",
        apiVersion: `2026-07-${String(index - 70).padStart(2, "0")}`,
        payload,
      },
      baseline: { scenario, endpoint: "/v2/outliers", payload },
    };
  return {
    candidate: {
      scenario,
      endpoint: "/v2/unique",
      revision: index,
      payload,
    },
    baseline: { scenario, endpoint: "/v2/unique", revision: 1, payload },
  };
}

function formatSnapshotValue(value, depth = 0) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  const indent = "  ".repeat(depth);
  const childIndent = "  ".repeat(depth + 1);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[\n${value
      .map((item) => `${childIndent}${formatSnapshotValue(item, depth + 1)},`)
      .join("\n")}\n${indent}]`;
  }
  const entries = Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  if (entries.length === 0) return "{}";
  return `{\n${entries
    .map(
      ([key, item]) =>
        `${childIndent}${JSON.stringify(key)}: ${formatSnapshotValue(item, depth + 1)},`,
    )
    .join("\n")}\n${indent}}`;
}

const tests = Array.from({ length: scenarioCount }, (_, offset) => {
  const index = offset + 1;
  const { candidate } = valuesFor(index);
  return `  it(${JSON.stringify(scenarioName(index))}, () => {
    const response = ${JSON.stringify(candidate, null, 4)
      .split("\n")
      .map((line, lineIndex) => (lineIndex === 0 ? line : `    ${line}`))
      .join("\n")};
    expect(response).toMatchSnapshot();
  });`;
}).join("\n\n");

const source = `import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const requestCache = new Map<string, unknown>();

function resetRequestCache() {
  requestCache.clear();
}

describe(${JSON.stringify(suiteName)}, () => {
  beforeAll(() => {
    requestCache.set("suite", ${JSON.stringify(suiteName)});
  });

  beforeEach(() => {
    resetRequestCache();
  });

${tests}
});
`;

const snapshots = [
  "// Vitest Snapshot v1, https://vitest.dev/guide/snapshot.html",
  "",
  ...Array.from({ length: scenarioCount }, (_, offset) => {
    const index = offset + 1;
    const { baseline } = valuesFor(index);
    return `exports[\`${suiteName} > ${scenarioName(index)} 1\`] = \`\n${formatSnapshotValue(baseline)}\n\`;\n`;
  }),
].join("\n");

await mkdir(snapshotRoot, { recursive: true });
await writeFile(resolve(sourceRoot, "families.test.ts"), source);
await writeFile(resolve(snapshotRoot, "families.test.ts.snap"), snapshots);

console.log(
  "Generated 100 tests: recurring families of 40, 25, 15, and 10 changes, plus 10 outliers.",
);
