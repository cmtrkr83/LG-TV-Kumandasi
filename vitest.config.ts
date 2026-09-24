import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const workspaceRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(workspaceRoot, "artifacts/netcast-remote"),
      "@react-native-async-storage/async-storage": path.resolve(
        workspaceRoot,
        "tests/helpers/async-storage-mock.ts",
      ),
      "expo-secure-store": path.resolve(
        workspaceRoot,
        "tests/helpers/secure-store-mock.ts",
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/static-build/**"],
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
