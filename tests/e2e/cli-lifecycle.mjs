import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

export async function verifyCliLifecycle() {
  const repositoryRoot = resolve(process.cwd());
  const temporaryRoot = resolve(repositoryRoot, ".tmp");
  const workspacePath = resolve(temporaryRoot, "phase1d-cli-lifecycle");
  if (!workspacePath.startsWith(`${temporaryRoot}\\`) && !workspacePath.startsWith(`${temporaryRoot}/`)) throw new Error("CLI lifecycle workspace escaped repository .tmp");
  mkdirSync(temporaryRoot, { recursive: true });
  rmSync(workspacePath, { recursive: true, force: true });
  const port = 41788;
  const child = spawn(process.execPath, [
    resolve(repositoryRoot, "dist/src/cli/index.js"),
    "--workspace", workspacePath,
    "serve", "--port", String(port), "--no-open",
  ], { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const deadline = Date.now() + 10_000;
  try {
    while (!output.includes(`http://127.0.0.1:${port}`)) {
      if (child.exitCode !== null) throw new Error(`band8 serve exited before startup: ${output}`);
      if (Date.now() > deadline) throw new Error(`band8 serve startup timed out: ${output}`);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
    }
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/today`);
    if (response.status !== 200) throw new Error(`band8 serve health returned ${response.status}`);
    child.kill(process.platform === "win32" ? "SIGTERM" : "SIGINT");
    await Promise.race([
      new Promise((resolveExit, rejectExit) => {
        child.once("exit", resolveExit);
        child.once("error", rejectExit);
      }),
      new Promise((_, rejectTimeout) => setTimeout(() => rejectTimeout(new Error("band8 serve did not exit after shutdown signal")), 5_000)),
    ]);
    let stopped = false;
    try { await fetch(`http://127.0.0.1:${port}/api/v1/today`); } catch { stopped = true; }
    if (!stopped) throw new Error("band8 serve port remained reachable after shutdown");
    process.stdout.write("CLI lifecycle: startup, HTTP, shutdown, and port release passed\n");
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
    rmSync(workspacePath, { recursive: true, force: true });
  }
}
