import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    core: "src/core.ts",
    runner: "src/runner.ts",
    server: "src/server.ts",
    cli: "src/cli.ts",
    environment: "src/environment.ts",
  },
  platform: "node",
  format: "esm",
  dts: true,
  sourcemap: true,
  clean: true,
  external: [/^vitest(?:\/.*)?$/],
  noExternal: [/^@vsnap\//],
});
