import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { mockupPreviewPlugin } from "./mockupPreviewPlugin";
import { normalizeBasePath } from "./basePath";

const port = Number(process.env.PORT ?? 5173);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid PORT value: "${process.env.PORT}"`);
}

const host = process.env.HOST?.trim() || "127.0.0.1";
if (host.includes("*") || /[\s/@\\?#]/.test(host)) {
  throw new Error(`Invalid HOST value: "${process.env.HOST}"`);
}

const basePath = normalizeBasePath(process.env.BASE_PATH);

function getAllowedHosts(): string[] {
  const configuredHosts = (process.env.ALLOWED_HOSTS ?? "localhost,127.0.0.1,::1")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (
    configuredHosts.length === 0 ||
    configuredHosts.some(
      (value) =>
        value.includes("*") || /[\s/@\\?#]/.test(value)
    )
  ) {
    throw new Error("Invalid ALLOWED_HOSTS value");
  }

  return [...new Set([...configuredHosts, host])];
}

const allowedHosts = getAllowedHosts();

export default defineConfig({
  base: basePath,
  plugins: [mockupPreviewPlugin(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
  },
  server: {
    port,
    host,
    allowedHosts,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host,
    allowedHosts,
  },
});
