import { defineConfig } from "vitest/config";
import path from "node:path";

const alias = { "@": path.resolve(__dirname, "src") };

export default defineConfig({
  resolve: { alias },
  test: {
    fileParallelism: false,
    projects: [
      {
        resolve: { alias },
        test: { name: "unit", include: ["tests/unit/**/*.test.ts", "tests/golden/**/*.test.ts", "tests/adversarial/**/*.test.ts"], environment: "node" },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/integration/globalSetup.ts"],
          setupFiles: ["tests/integration/setup.ts"],
          env: {
            STORAGE_DRIVER: "local",
            STORAGE_LOCAL_ROOT: "./storage-test",
            CLAMAV_HOST: "",
          },
          testTimeout: 30000,
        },
      },
    ],
  },
});
