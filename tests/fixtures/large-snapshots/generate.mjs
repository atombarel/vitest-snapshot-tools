import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const target = resolve("src/__snapshots__/large.test.ts.snap");
const value = Array.from(
  { length: 50_000 },
  (_, index) => `line ${String(index + 1).padStart(5, "0")}`,
).join("\\n");
await mkdir(dirname(target), { recursive: true });
await writeFile(target, `exports[\`large snapshot 1\`] = \`${value}\`;\n`);
