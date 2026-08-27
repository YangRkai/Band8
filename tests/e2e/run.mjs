import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { verifyCliLifecycle } from "./cli-lifecycle.mjs";

const cli = resolve(process.cwd(), "node_modules/@playwright/test/cli.js");

function run(files, environment = {}) {
  const result = spawnSync(process.execPath, [cli, "test", ...files], {
    cwd: process.cwd(),
    env: { ...process.env, ...environment },
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

await verifyCliLifecycle();
run(["tests/e2e/band8.spec.ts"]);
run(["tests/e2e/restart.spec.ts"], { BAND8_E2E_PRESERVE: "1", BAND8_E2E_RESTART: "1" });
