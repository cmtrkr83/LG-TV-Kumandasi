import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../lib/api-spec",
);
const repositoryRoot = path.resolve(packageRoot, "../..");
const generatedRoots = [
  path.join(repositoryRoot, "lib/api-client-react/src/generated"),
  path.join(repositoryRoot, "lib/api-zod/src/generated"),
];

async function collectFiles(root) {
  const files = new Map();
  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile()) {
        files.set(path.relative(root, entryPath), await readFile(entryPath));
      }
    }
  }
  await visit(root);
  return files;
}

async function snapshotGeneratedTrees(snapshotRoot) {
  const snapshots = new Map();
  for (const [index, root] of generatedRoots.entries()) {
    const snapshotPath = path.join(snapshotRoot, String(index));
    await cp(root, snapshotPath, { recursive: true });
    snapshots.set(index, {
      path: snapshotPath,
      files: await collectFiles(snapshotPath),
    });
  }
  return snapshots;
}

async function restoreGeneratedTrees(snapshots) {
  for (const [index, root] of generatedRoots.entries()) {
    const snapshot = snapshots.get(index);
    if (!snapshot) continue;
    await rm(root, { recursive: true, force: true });
    await cp(snapshot.path, root, { recursive: true });
    const restored = await collectFiles(root);
    for (const [name, content] of snapshot.files) {
      if (!restored.get(name)?.equals(content)) {
        throw new Error(`Failed to restore ${path.join(root, name)}`);
      }
    }
    for (const name of restored.keys()) {
      if (!snapshot.files.has(name)) {
        throw new Error(`Failed to restore ${path.join(root, name)}`);
      }
    }
  }
}

function runCodegen() {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["run", "codegen"], {
      cwd: packageRoot,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(`codegen failed (${code ?? "null"}/${signal ?? "null"})`),
      );
    });
  });
}

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "orval-generated-"));
let snapshots;
let codegenError;
let changed;
try {
  snapshots = await snapshotGeneratedTrees(temporaryRoot);
  try {
    await runCodegen();
  } catch (error) {
    codegenError = error;
  }
  const temporaryChanged = [];
  for (const [index, root] of generatedRoots.entries()) {
    const after = await collectFiles(root);
    const previous = snapshots.get(index)?.files ?? new Map();
    const names = new Set([...previous.keys(), ...after.keys()]);
    for (const name of names) {
      const previousContent = previous.get(name);
      const nextContent = after.get(name);
      if (
        !previousContent ||
        !nextContent ||
        !previousContent.equals(nextContent)
      ) {
        temporaryChanged.push(
          path.relative(repositoryRoot, path.join(root, name)),
        );
      }
    }
  }
  changed = temporaryChanged;
} finally {
  try {
    if (snapshots) {
      await restoreGeneratedTrees(snapshots);
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

if (codegenError) {
  console.error(
    codegenError instanceof Error ? codegenError.message : String(codegenError),
  );
  process.exitCode = 1;
}
if (changed?.length) {
  console.error(`Generated files changed:\n${changed.join("\n")}`);
  process.exitCode = 1;
}
if (!codegenError && changed?.length === 0) {
  console.log("Generated files are up to date.");
}
