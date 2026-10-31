import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

import { vitestCaches } from "../../vitest.cache";

const testCaches = vitestCaches(
  fileURLToPath(new URL("../..", import.meta.url)),
);

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Match the host's runtime source aliases. Shared UI resolves through the
    // installed package, not an assumed sibling checkout.
    alias: {
      "@omniviewdev/runtime/api": fileURLToPath(
        new URL(
          "../../packages/omniviewdev-runtime/src/api.ts",
          import.meta.url,
        ),
      ),
      "@omniviewdev/runtime/models": fileURLToPath(
        new URL(
          "../../packages/omniviewdev-runtime/src/models.ts",
          import.meta.url,
        ),
      ),
      "@omniviewdev/runtime": fileURLToPath(
        new URL(
          "../../packages/omniviewdev-runtime/src/index.ts",
          import.meta.url,
        ),
      ),
    },
  },
  cacheDir: testCaches.cacheDir,
  test: {
    fsModuleCachePath: testCaches.fsModuleCachePath,
    environment: "jsdom",
    include: ["bench/app/resource-benchmark-lifecycle.test.tsx"],
    fileParallelism: false,
  },
});
