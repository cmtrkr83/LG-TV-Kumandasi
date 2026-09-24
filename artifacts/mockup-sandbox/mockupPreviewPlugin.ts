import path from "path";
import glob from "fast-glob";
import chokidar from "chokidar";
import type { FSWatcher } from "chokidar";
import type { Plugin, ViteDevServer } from "vite";

const MOCKUPS_DIR = "src/components/mockups";
const VIRTUAL_MODULE_ID = "virtual:mockup-components";
const RESOLVED_VIRTUAL_MODULE_ID = `\0${VIRTUAL_MODULE_ID}`;

interface DiscoveredComponent {
  globKey: string;
  importPath: string;
}

function comparePaths(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function mockupPreviewPlugin(): Plugin {
  let root = "";
  let currentSource = "";
  let hasScanned = false;
  let watcher: FSWatcher | null = null;
  let refreshQueue: Promise<boolean> = Promise.resolve(false);

  function getMockupsAbsDir(): string {
    return path.join(root, MOCKUPS_DIR);
  }

  function isMockupFile(absolutePath: string): boolean {
    const relativePath = path.relative(getMockupsAbsDir(), absolutePath);
    return (
      !relativePath.startsWith("..") &&
      !path.isAbsolute(relativePath) &&
      relativePath.endsWith(".tsx")
    );
  }

  function isPreviewTarget(relativeToMockups: string): boolean {
    return relativeToMockups
      .split(path.sep)
      .every((segment) => !segment.startsWith("_"));
  }

  async function discoverComponents(): Promise<Array<DiscoveredComponent>> {
    const files = await glob(`${MOCKUPS_DIR}/**/*.tsx`, {
      cwd: root,
      ignore: ["**/_*/**", "**/_*.tsx"],
      onlyFiles: true,
      unique: true,
    });

    return files.sort(comparePaths).map((file) => {
      const sourcePath = file.replaceAll("\\", "/");
      const relativePath = sourcePath.slice(`${MOCKUPS_DIR}/`.length);
      return {
        globKey: `./components/mockups/${relativePath}`,
        importPath: `/${MOCKUPS_DIR}/${relativePath}`,
      };
    });
  }

  function generateSource(components: Array<DiscoveredComponent>): string {
    const entries = components
      .map(
        (component) =>
          `  ${JSON.stringify(component.globKey)}: () => import(${JSON.stringify(component.importPath)})`,
      )
      .join(",\n");

    return [
      "export const modules = {",
      entries,
      "};",
      "",
    ].join("\n");
  }

  function refresh(): Promise<boolean> {
    const run = async () => {
      const components = await discoverComponents();
      const nextSource = generateSource(components);
      hasScanned = true;
      if (nextSource === currentSource) {
        return false;
      }
      currentSource = nextSource;
      return true;
    };

    const result = refreshQueue.then(run, run);
    refreshQueue = result.then(
      () => false,
      () => false,
    );
    return result;
  }

  function reportServerError(server: ViteDevServer, error: unknown): void {
    const normalizedError = toError(error);
    const message = `Mockup preview refresh failed: ${normalizedError.message}`;
    server.config.logger.error(message);
    server.ws.send({
      type: "error",
      err: {
        message,
        stack: normalizedError.stack ?? message,
      },
    });
  }

  async function refreshServer(server: ViteDevServer): Promise<void> {
    const changed = await refresh();
    if (!changed) {
      return;
    }

    const virtualModule = server.moduleGraph.getModuleById(
      RESOLVED_VIRTUAL_MODULE_ID,
    );
    if (virtualModule) {
      server.moduleGraph.invalidateModule(virtualModule);
    }
    server.ws.send({ type: "full-reload" });
  }

  async function closeFileWatcher(): Promise<void> {
    const currentWatcher = watcher;
    watcher = null;
    if (currentWatcher) {
      await currentWatcher.close();
    }
  }

  return {
    name: "mockup-preview",
    enforce: "pre",

    configResolved(config) {
      root = config.root;
    },

    resolveId(source) {
      return source === VIRTUAL_MODULE_ID ? RESOLVED_VIRTUAL_MODULE_ID : null;
    },

    async load(id) {
      if (id !== RESOLVED_VIRTUAL_MODULE_ID) {
        return null;
      }
      if (!hasScanned) {
        await refresh();
      }
      return currentSource;
    },

    async buildStart() {
      await refresh();
    },

    async configureServer(server) {
      await refresh()

      const mockupsAbsDir = getMockupsAbsDir();

      const refreshFromWatcher = () => {
        void refreshServer(server).catch((error: unknown) => {
          reportServerError(server, error);
        });
      };

      watcher = chokidar.watch(mockupsAbsDir, {
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 100,
          pollInterval: 50,
        },
      });

      watcher.on("add", (file) => {
        if (
          isMockupFile(file) &&
          isPreviewTarget(path.relative(mockupsAbsDir, file))
        ) {
          refreshFromWatcher();
        }
      });

      watcher.on("unlink", (file) => {
        if (isMockupFile(file)) {
          refreshFromWatcher();
        }
      });

      watcher.on("error", (error) => {
        reportServerError(server, error);
      });
    },

    async handleHotUpdate({ file, server }) {
      if (
        !isMockupFile(file) ||
        !isPreviewTarget(path.relative(getMockupsAbsDir(), file))
      ) {
        return
      }
      try {
        await refreshServer(server);
      } catch (error) {
        reportServerError(server, error);
        throw toError(error);
      }
    },

    closeWatcher: closeFileWatcher,
    closeBundle: closeFileWatcher,
  };
}
