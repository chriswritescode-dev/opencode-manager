import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        "test/",
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/types/**",
        "vitest.config.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.ts"],
    exclude: ["test/integration/**"],
    testTimeout: 10000,
    hookTimeout: 10000,
    server: {
      deps: {
        external: ["bun"],
      },
    },
  },
});
