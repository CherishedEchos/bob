import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "tests/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    pool: "forks",
    env: { BOB_DB_PATH: ":memory:", TZ: "Europe/London" },
    testTimeout: 20000,
  },
});
