import { chmod, cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const destination = resolve(here, "..");
await rm(resolve(destination, "web"), { recursive: true, force: true });
await rm(resolve(destination, "skill"), { recursive: true, force: true });
await mkdir(resolve(destination, "skill"), { recursive: true });
await cp(resolve(root, "apps/web/dist"), resolve(destination, "web"), {
  recursive: true,
});
await cp(
  resolve(root, "skills/review-vitest-snapshots"),
  resolve(destination, "skill/review-vitest-snapshots"),
  { recursive: true },
);
await chmod(resolve(destination, "dist/cli.js"), 0o755);
