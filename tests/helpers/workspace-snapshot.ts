import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export interface WorkspaceSnapshotEntry {
  path: string;
  size: number;
  sha256: string;
}

export function snapshotWorkspace(root: string): WorkspaceSnapshotEntry[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  visit(root);
  return files
    .map((path) => {
      const bytes = readFileSync(path);
      return {
        path: relative(root, path).replaceAll("\\", "/"),
        size: statSync(path).size,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}
