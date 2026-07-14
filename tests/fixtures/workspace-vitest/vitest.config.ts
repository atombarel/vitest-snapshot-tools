import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "alpha", include: ["alpha/**/*.test.ts"] } },
      { test: { name: "beta", include: ["beta/**/*.test.ts"] } },
    ],
  },
});
