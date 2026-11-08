import { readFileSync } from "node:fs";
import path from "path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(
      JSON.parse(readFileSync(path.resolve(__dirname, "../package.json"), "utf8")).version,
    ),
  },
  test: {
    environment: "jsdom",
    environmentOptions: {
      jsdom: {
        url: "http://localhost",
      },
    },
    globals: true,
    env: {
      NODE_ENV: "test",
    },
    setupFiles: ["./src/test/setup.ts"],
    css: {
      include: [/[?&]raw(?:&|$)/],
    },
    include: ["src/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
