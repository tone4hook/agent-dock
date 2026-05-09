import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    setupFiles: ["test/setup.ts"],
    testTimeout: 20_000,
    // Coordinator tests create real git repos. Keep file execution
    // sequential so worktree cleanup and session polling stay stable.
    pool: "forks",
    poolOptions: { forks: { singleFork: false, maxForks: 1 } },
    fileParallelism: false,
  },
});
