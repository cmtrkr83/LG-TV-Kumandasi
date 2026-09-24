import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { build } from "vite";
import { normalizeBasePath } from "../artifacts/mockup-sandbox/basePath";
import { mockupPreviewPlugin } from "../artifacts/mockup-sandbox/mockupPreviewPlugin";
import { resolvePreviewComponent } from "../artifacts/mockup-sandbox/src/lib/preview-component";
import { cn } from "../artifacts/mockup-sandbox/src/lib/utils";

describe("mockup preview resolver and utilities", () => {
  it("discovers public mockups and hides underscore-prefixed paths", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lg-tv-mockup-"));
    try {
      await mkdir(path.join(root, "src/components/mockups/_private"), {
        recursive: true,
      });
      await writeFile(
        path.join(root, "src/components/mockups/Example.tsx"),
        "export default function Example() { return null }\n",
      );
      await writeFile(
        path.join(root, "src/components/mockups/_private/Hidden.tsx"),
        "export default function Hidden() { return null }\n",
      );

      const plugin = mockupPreviewPlugin();
      const configResolved = plugin.configResolved as unknown as (config: {
        root: string;
      }) => void;
      const resolveId = plugin.resolveId as unknown as (
        source: string,
      ) => string | Promise<string>;
      const load = plugin.load as unknown as (
        id: string,
      ) => string | Promise<string> | null;

      configResolved({ root });
      expect(await resolveId("virtual:mockup-components")).toBe(
        "\0virtual:mockup-components",
      );
      const source = await load("\0virtual:mockup-components");
      expect(source).toContain("./components/mockups/Example.tsx");
      expect(source).not.toContain("Hidden.tsx");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("merges conditional class names with tailwind conflict resolution", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-sm", { "font-bold": true })).toBe("text-sm font-bold");
  });
});

describe("mockup preview component resolver", () => {
  it("resolves a default export from a module", () => {
    const defaultPreview = () => null;
    const previewModule = Object.freeze({ default: defaultPreview });

    expect(resolvePreviewComponent(previewModule, "Default Preview.tsx")).toBe(
      defaultPreview,
    );
  });

  it("resolves a Preview export from a module", () => {
    const preview = () => null;
    const previewModule = Object.freeze({
      default: "invalid",
      Preview: preview,
    });

    expect(resolvePreviewComponent(previewModule, "Example.tsx")).toBe(preview);
  });

  it("resolves the file-name export without the .tsx extension", () => {
    const namedPreview = () => null;
    const previewModule = Object.freeze({ Example: namedPreview });

    expect(resolvePreviewComponent(previewModule, "nested/Example.tsx")).toBe(
      namedPreview,
    );
  });

  it("rejects a module without a valid contracted export", () => {
    const unrelatedExport = () => null;
    const invalidModule = Object.freeze({
      default: "invalid",
      Preview: 42,
      Example: { type: "invalid" },
      Other: unrelatedExport,
    });

    expect(resolvePreviewComponent(invalidModule, "Example.tsx")).toBeNull();
  });
});

describe("mockup BASE_PATH validation", () => {
  it.each([
    "",
    "relative/path",
    "https://example.test/assets",
    "//example.test/assets",
    "/assets//nested",
    "/assets/../secret",
    "/assets/%2e%2e/secret",
    "/assets\\nested",
    "/assets%5cnested",
    "/assets?query",
    "/assets%3Fquery",
    "/assets#fragment",
    "/assets%23fragment",
    "/assets\u0000control",
    "/assets%0Acontrol",
    "/assets%",
    "/assets%GG",
    "/assets%E0%A4%A",
  ])("rejects unsafe BASE_PATH %j", (value) => {
    expect(() => normalizeBasePath(value)).toThrow("Invalid BASE_PATH");
  });

  it("returns a normalized absolute path", () => {
    expect(normalizeBasePath(undefined)).toBe("/");
    expect(normalizeBasePath("/")).toBe("/");
    expect(normalizeBasePath("/canvas/")).toBe("/canvas");
    expect(normalizeBasePath("/T%C3%BCrk%C3%A7e%20Bo%C5%9Fluk/")).toBe(
      "/Türkçe Boşluk",
    );
  });
});

describe("mockup virtual module build", () => {
  it("builds with a Unicode and space-containing BASE_PATH", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lg-tv-mockup-build-"));
    try {
      const mockupsDirectory = path.join(root, "src/components/mockups");
      await mkdir(mockupsDirectory, { recursive: true });
      await writeFile(
        path.join(root, "index.html"),
        '<!doctype html><html><body><script type="module" src="/src/entry.ts"></script></body></html>\n',
      );
      await writeFile(
        path.join(root, "src/entry.ts"),
        'import { modules } from "virtual:mockup-components"; globalThis.__mockupModules = modules;\n',
      );
      await writeFile(
        path.join(mockupsDirectory, "Türkçe Boşluk.tsx"),
        "export default function Preview() { return null }\n",
      );

      const basePath = normalizeBasePath("/Türkçe Boşluk/");
      const realRoot = await realpath(root);
      const result = await build({
        base: basePath,
        configFile: false,
        logLevel: "silent",
        plugins: [mockupPreviewPlugin()],
        root: realRoot,
        build: {
          emptyOutDir: true,
          outDir: "dist",
          write: false,
        },
      });
      const buildResults = Array.isArray(result)
        ? result
        : "output" in result
          ? [result]
          : [];
      if (!buildResults.length) {
        throw new Error("Mockup build did not return Rollup output");
      }
      const outputs = buildResults.flatMap(({ output }) => output);
      const html = outputs.find(
        (output) =>
          output.type === "asset" && output.fileName.endsWith(".html"),
      );
      if (!html || html.type !== "asset") {
        throw new Error("Mockup build did not emit HTML");
      }
      const htmlSource = Buffer.from(html.source).toString("utf8");
      const mockupChunk = outputs.find(
        (output) => output.type === "chunk" && output.isDynamicEntry,
      );

      expect(basePath).toBe("/Türkçe Boşluk");
      expect(htmlSource).toContain(basePath);
      expect(mockupChunk?.fileName).toContain("Türkçe Boşluk");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
