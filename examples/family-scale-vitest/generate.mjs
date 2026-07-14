import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const scenarioCount = 100;
const suiteName = "customer platform HTTP contract";
const sourceRoot = resolve("src");
const snapshotRoot = resolve(sourceRoot, "__snapshots__");

function scenarioName(index) {
  return `request ${String(index).padStart(3, "0")}`;
}

function routeFor(index) {
  if (index <= 40) return "customers";
  if (index <= 65) return "orders";
  if (index <= 80) return "invoices";
  if (index <= 90) return "permissions";
  if (index <= 95) return "experiments";
  return "revisions";
}

function requestFor(index) {
  const route = routeFor(index);
  return {
    method: "GET",
    path: `/v2/${route}/${index}`,
    headers: {
      accept: "application/json",
      "x-request-id": `req-${String(index).padStart(4, "0")}`,
    },
  };
}

function baselineBody(index) {
  const route = routeFor(index);
  const common = {
    id: `${route.slice(0, 3)}_${String(index).padStart(4, "0")}`,
    name: `${route[0].toUpperCase()}${route.slice(1)} record ${index}`,
  };

  if (route === "orders") return { ...common, status: "active" };
  if (route === "invoices")
    return { ...common, amount: index * 125, currency: "USD" };
  if (route === "permissions")
    return { ...common, features: ["read", "write"] };
  if (route === "experiments") return { ...common, enabled: true };
  if (route === "revisions") return { ...common, revision: 1 };
  return { ...common, tier: index % 2 === 0 ? "business" : "starter" };
}

function candidateBody(index) {
  const body = baselineBody(index);
  const route = routeFor(index);
  if (route === "orders") {
    const { status, ...rest } = body;
    return { ...rest, state: status };
  }
  if (route === "invoices") return { ...body, currency: "EUR" };
  if (route === "permissions")
    return { ...body, features: ["read", "write", "audit"] };
  if (route === "revisions") return { ...body, revision: index };
  return body;
}

function exchangeFor(index, candidate) {
  const request = requestFor(index);
  const route = routeFor(index);
  const requestId = request.headers["x-request-id"];
  const responseBody = candidate ? candidateBody(index) : baselineBody(index);
  const meta = {
    requestId,
    servedAt: "2026-07-14T12:00:00.000Z",
  };

  if (candidate && route === "customers") meta.apiVersion = "2026-07-14";
  if (candidate && route === "experiments")
    meta.schemaVersion = `experiment-${index}`;

  return {
    externalApiCalls: [
      {
        method: "GET",
        url: `https://records.example.test/${route}/${index}`,
        headers: {
          accept: "application/json",
          "x-api-version":
            route === "customers"
              ? candidate
                ? "2026-07-14"
                : "2026-06-01"
              : "2026-07-14",
          "x-request-id": requestId,
        },
      },
    ],
    response: {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-request-id": requestId,
      },
      body: responseBody,
      meta,
    },
    logs: [
      {
        level: "info",
        event: "request.received",
        method: request.method,
        path: request.path,
        requestId,
      },
      {
        level: "info",
        event: "external-api.completed",
        requestId,
        status: 200,
        upstreamContract:
          route === "customers"
            ? candidate
              ? "customers-2026-07-14"
              : "customers-2026-06-01"
            : `${route}-2026-07-14`,
      },
      {
        level: "info",
        event: "response.sent",
        durationMs: 8 + (index % 5),
        requestId,
        status: 200,
      },
    ],
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

const contracts = `export interface HttpRequest {
  method: "GET" | "POST";
  path: string;
  headers: Record<string, string>;
}

export interface LogRecord {
  level: "info" | "error";
  event: string;
  requestId: string;
  [field: string]: unknown;
}
`;

const logger = `import type { LogRecord } from "./contracts";

export function createRequestLogger(requestId: string) {
  const records: LogRecord[] = [];
  return {
    info(event: string, fields: Record<string, unknown>) {
      records.push({ level: "info", event, ...fields, requestId });
    },
    records() {
      return structuredClone(records);
    },
  };
}
`;

const externalApiMock = `import type { HttpRequest } from "./contracts";

export interface ExternalApiCall {
  method: "GET";
  url: string;
  headers: Record<string, string>;
}

function resource(route: string, id: number): Record<string, unknown> {
  const common = {
    id: \`\${route.slice(0, 3)}_\${String(id).padStart(4, "0")}\`,
    name: \`\${route[0].toUpperCase()}\${route.slice(1)} record \${id}\`,
  };
  if (route === "orders") return { ...common, state: "active" };
  if (route === "invoices")
    return { ...common, amount: id * 125, currency: "EUR" };
  if (route === "permissions")
    return { ...common, features: ["read", "write", "audit"] };
  if (route === "experiments") return { ...common, enabled: true };
  if (route === "revisions") return { ...common, revision: id };
  return { ...common, tier: id % 2 === 0 ? "business" : "starter" };
}

export function createExternalApiMock() {
  const calls: ExternalApiCall[] = [];
  return {
    async get(route: string, id: number, request: HttpRequest) {
      calls.push({
        method: "GET",
        url: \`https://records.example.test/\${route}/\${id}\`,
        headers: {
          accept: "application/json",
          "x-api-version": "2026-07-14",
          "x-request-id": request.headers["x-request-id"],
        },
      });
      return resource(route, id);
    },
    calls() {
      return structuredClone(calls);
    },
  };
}
`;

const router = `const routeNames = [
  "customers",
  "orders",
  "invoices",
  "permissions",
  "experiments",
  "revisions",
] as const;

type RouteName = (typeof routeNames)[number];

export function matchRoute(path: string): { route: RouteName; id: number } {
  const match = /^\\/v2\\/([^/]+)\\/(\\d+)$/.exec(path);
  if (!match || !routeNames.includes(match[1] as RouteName))
    throw new Error(\`No route for \${path}\`);
  return { route: match[1] as RouteName, id: Number(match[2]) };
}
`;

const app = `import type { HttpRequest } from "./contracts";
import type { createExternalApiMock } from "./external-api.mock";
import { createRequestLogger } from "./logger";
import { matchRoute } from "./router";

export function createCustomerPlatform(
  externalApi: ReturnType<typeof createExternalApiMock>,
) {
  return {
    async handle(request: HttpRequest) {
      const requestId = request.headers["x-request-id"];
      const logger = createRequestLogger(requestId);
      const { route, id } = matchRoute(request.path);
      logger.info("request.received", {
        method: request.method,
        path: request.path,
      });
      const body = await externalApi.get(route, id, request);
      logger.info("external-api.completed", {
        status: 200,
        upstreamContract: \`\${route}-2026-07-14\`,
      });

      const meta: Record<string, unknown> = {
        requestId,
        servedAt: "2026-07-14T12:00:00.000Z",
      };
      if (route === "customers") meta.apiVersion = "2026-07-14";
      if (route === "experiments") meta.schemaVersion = \`experiment-\${id}\`;

      const response = {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "x-request-id": requestId,
        },
        body,
        meta,
      };
      logger.info("response.sent", {
        durationMs: 8 + (id % 5),
        status: response.status,
      });

      return {
        externalApiCalls: externalApi.calls(),
        response,
        logs: logger.records(),
      };
    },
  };
}
`;

function testSource(index) {
  const request = requestFor(index);
  return `  it(${JSON.stringify(scenarioName(index))}, async () => {
    const externalApi = createExternalApiMock();
    const app = createCustomerPlatform(externalApi);
    const exchange = await app.handle({
      method: "GET",
      path: ${JSON.stringify(request.path)},
      headers: {
        accept: "application/json",
        "x-request-id": ${JSON.stringify(request.headers["x-request-id"])},
      },
    });
    expect(exchange.externalApiCalls).toMatchSnapshot("external API calls");
    expect(exchange.logs).toMatchSnapshot("request logs");
    expect(exchange.response).toMatchSnapshot("HTTP response");
  });`;
}

const routeSuites = [
  ["customers", 1, 40],
  ["orders", 41, 65],
  ["invoices", 66, 80],
  ["permissions", 81, 90],
  ["experiments", 91, 95],
  ["revisions", 96, 100],
].map(
  ([route, first, last]) => `  describe("GET /v2/${route}/:id", () => {
${Array.from({ length: last - first + 1 }, (_, offset) =>
  testSource(first + offset)
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n"),
).join("\n\n")}
  });`,
);

const source = `import { describe, expect, it } from "vitest";
import { createCustomerPlatform } from "./app";
import { createExternalApiMock } from "./external-api.mock";

describe(${JSON.stringify(suiteName)}, () => {
${routeSuites.join("\n\n")}
});
`;

const snapshots = [
  "// Vitest Snapshot v1, https://vitest.dev/guide/snapshot.html",
  "",
  ...Array.from({ length: scenarioCount }, (_, offset) => {
    const index = offset + 1;
    const exchange = exchangeFor(index, false);
    const testName = `${suiteName} > GET /v2/${routeFor(index)}/:id > ${scenarioName(index)}`;
    return [
      ["HTTP response", exchange.response],
      ["external API calls", exchange.externalApiCalls],
      ["request logs", exchange.logs],
    ]
      .map(
        ([snapshotName, value]) =>
          `exports[\`${testName} > ${snapshotName} 1\`] = \`\n${formatSnapshotValue(value)}\n\`;`,
      )
      .join("\n\n");
  }),
].join("\n");

await mkdir(snapshotRoot, { recursive: true });
await writeFile(resolve(sourceRoot, "contracts.ts"), contracts);
await writeFile(resolve(sourceRoot, "external-api.mock.ts"), externalApiMock);
await writeFile(resolve(sourceRoot, "logger.ts"), logger);
await writeFile(resolve(sourceRoot, "router.ts"), router);
await writeFile(resolve(sourceRoot, "app.ts"), app);
await writeFile(resolve(sourceRoot, "families.test.ts"), source);
await writeFile(resolve(snapshotRoot, "families.test.ts.snap"), snapshots);

console.log(
  "Generated a deterministic HTTP app with 100 external-call/log/response snapshot sets: three recurring families of 40 plus families of 25, 15, and 10 changes, followed by 10 outliers.",
);
