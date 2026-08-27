import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

import { startBand8Server } from "../../src/server/server.js";

export default async function setup(): Promise<() => Promise<void>> {
  const repositoryRoot = resolve(process.cwd());
  const temporaryRoot = resolve(repositoryRoot, ".tmp");
  const workspacePath = resolve(temporaryRoot, "phase1d-browser-dogfood");
  if (!workspacePath.startsWith(`${temporaryRoot}\\`) && !workspacePath.startsWith(`${temporaryRoot}/`)) {
    throw new Error("refusing to prepare E2E workspace outside repository .tmp");
  }
  mkdirSync(temporaryRoot, { recursive: true });
  if (process.env.BAND8_E2E_PRESERVE !== "1") rmSync(workspacePath, { recursive: true, force: true });
  const artifactIds = ["artifact-writing-golden-draft", "artifact-writing-golden-revision", "artifact-writing-golden-transfer"];
  let event = 0;
  let second = 0;
  const running = await startBand8Server({
    repositoryRoot,
    workspacePath,
    port: 41789,
    runtimeOptions: {
      eventIdFactory: () => `event-phase1d-browser-${++event}`,
      artifactIdFactory: () => artifactIds.shift() ?? `artifact-phase1d-browser-${crypto.randomUUID()}`,
      now: () => new Date(Date.UTC(2026, 7, 27, 12, 0, second++)).toISOString(),
    },
  });
  return async () => { await running.close(); };
}
