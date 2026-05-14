import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: resolve(here, "src/editor"),
  build: {
    outDir: resolve(here, "dist/static"),
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
  },
});
