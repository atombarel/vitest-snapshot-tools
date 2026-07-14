import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      {
        find: /^@\//,
        replacement: `${fileURLToPath(new URL("./src", import.meta.url))}/`,
      },
      {
        find: /^shiki$/,
        replacement: fileURLToPath(
          new URL("./src/shiki-bundle.ts", import.meta.url),
        ),
      },
      {
        find: /^shiki\/wasm$/,
        replacement: fileURLToPath(
          new URL("./src/shiki-wasm.ts", import.meta.url),
        ),
      },
      {
        find: /^@pierre\/theming\/themes$/,
        replacement: fileURLToPath(
          new URL("./src/diff-themes.ts", import.meta.url),
        ),
      },
    ],
  },
  build: { target: "es2022", sourcemap: false, outDir: "dist" },
  server: { proxy: { "/api": "http://127.0.0.1:51204" } },
});
