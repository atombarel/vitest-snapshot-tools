import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const cli = resolve("../../packages/vitest-snapshot-tools/dist/cli.js");

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(
      result.stderr || result.stdout || `Command failed: ${command}`,
    );
  return result.stdout.trim();
}

run(process.execPath, ["generate.mjs"]);
const generatedTest = readFileSync(resolve("src/families.test.ts"), "utf8");
const generatedApp = readFileSync(resolve("src/app.ts"), "utf8");
const generatedExternalApi = readFileSync(
  resolve("src/external-api.mock.ts"),
  "utf8",
);
assert.match(generatedTest, /await app\.handle/);
assert.match(generatedTest, /toMatchSnapshot\("external API calls"\)/);
assert.match(generatedTest, /toMatchSnapshot\("request logs"\)/);
assert.match(generatedTest, /toMatchSnapshot\("HTTP response"\)/);
assert.match(generatedExternalApi, /calls\.push/);
assert.match(generatedApp, /request\.received/);
assert.match(generatedApp, /external-api\.completed/);
assert.match(generatedApp, /response\.sent/);
const capture = JSON.parse(run(process.execPath, [cli, "run", "--json"]));
assert.equal(capture.data.summary.total, 100);
assert.equal(capture.data.summary.snapshotChanges, 180);
assert.equal(capture.data.exactFamilies, 16);

const listed = JSON.parse(
  run(process.execPath, [cli, "families", "--status", "pending", "--json"]),
);
const counts = listed.data.items.map((item) => item.childCount);
assert.deepEqual(counts.slice(0, 6), [40, 40, 40, 25, 15, 10]);
assert.equal(listed.data.total, 16);
assert.deepEqual(
  new Set(listed.data.items.slice(0, 3).map((item) => item.label)),
  new Set([
    "2 related changes · 3 removed · 3 added",
    '"upstreamContract": "customers-2026-06-01", → "upstreamContract": "customers-2026-07-14",',
    'Added "apiVersion": "2026-07-14",',
  ]),
);
assert.equal(
  counts.slice(6).every((count) => count === 1),
  true,
);
assert.deepEqual(
  listed.data.items.slice(0, 6).map((item) => item.testCount),
  [40, 40, 40, 25, 15, 10],
);

console.log(
  "Verified 180 changes from 100 realistic HTTP exchanges compact into 6 recurring families and 10 exact outliers.",
);
