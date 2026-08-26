import { createHash } from "node:crypto";
import { mkdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export interface RuntimeWorkspace {
  root: string;
  paths: Record<"packages" | "protected" | "sessions" | "artifacts" | "registry", string>;
}

export function initializeWorkspace(path: string): RuntimeWorkspace {
  if (path.trim().length === 0) throw new Error("workspace path is required");
  const requested = resolve(path);
  if (!isAbsolute(requested)) throw new Error("workspace path must resolve absolutely");
  mkdirSync(requested, { recursive: true });
  const root = realpathSync(requested);
  const paths = {
    packages: join(root, "packages"),
    protected: join(root, "protected"),
    sessions: join(root, "sessions"),
    artifacts: join(root, "artifacts"),
    registry: join(root, "registry"),
  };
  for (const directory of Object.values(paths)) mkdirSync(directory, { recursive: true });
  return { root, paths };
}

export function storageKey(identifier: string): string {
  return createHash("sha256").update(identifier, "utf8").digest("hex");
}
