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
assert.match(generatedTest, /await app\.handle/);
assert.match(generatedApp, /request\.received/);
assert.match(generatedApp, /response\.sent/);
const capture = JSON.parse(run(process.execPath, [cli, "run", "--json"]));
assert.equal(capture.data.summary.total, 100);
assert.equal(capture.data.summary.snapshotChanges, 100);

const listed = JSON.parse(
  run(process.execPath, [cli, "list", "--kind", "family", "--json"]),
);
const counts = listed.data.items.map((item) => item.childCount);
assert.deepEqual(counts.slice(0, 4), [40, 25, 15, 10]);
assert.equal(listed.data.total, 14);
assert.equal(
  counts.slice(4).every((count) => count === 1),
  true,
);
assert.deepEqual(
  listed.data.items.slice(0, 4).map((item) => item.testCount),
  [40, 25, 15, 10],
);

console.log(
  "Verified 100 realistic HTTP exchanges compact into 4 recurring families and 10 exact outliers.",
);
