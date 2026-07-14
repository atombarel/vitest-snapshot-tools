import { readFile } from "node:fs/promises";

const tag = process.argv.slice(2).find((argument) => argument !== "--");
if (!tag) throw new Error("Pass a release tag such as v0.1.0");
if (!/^v\d+\.\d+\.\d+$/.test(tag))
  throw new Error(`Release tags must use vMAJOR.MINOR.PATCH: ${tag}`);

const packageJson = JSON.parse(
  await readFile(
    new URL("../packages/vitest-snapshot-tools/package.json", import.meta.url),
    "utf8",
  ),
);
const expected = `v${packageJson.version}`;
if (tag !== expected)
  throw new Error(`Tag ${tag} does not match package version ${expected}`);

console.log(`${tag} matches vitest-snapshot-tools@${packageJson.version}`);
