import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { target: "es2022", sourcemap: true, outDir: "dist" },
  server: { proxy: { "/api": "http://127.0.0.1:51204" } },
});
