import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    sourcemap: true,
    assetsInlineLimit: 4096,
  },
  server: {
    port: 4173,
  },
  preview: {
    port: 4173,
  },
});
