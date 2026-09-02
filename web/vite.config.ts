import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": process.env.BAND8_API_URL ?? "http://127.0.0.1:8765",
    },
  },
});
