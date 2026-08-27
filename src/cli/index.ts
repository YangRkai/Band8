#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";

import { canonicalJson, parseJsonStrict } from "../protocol/canonical.js";
import { createProtocolValidator } from "../protocol/validator.js";
import { Band8Runtime } from "../runtime/runtime.js";
import { startBand8Server, type RunningBand8Server, type StartBand8ServerOptions } from "../server/server.js";

interface CliDependencies {
  repositoryRoot?: string;
  write?: (value: string) => void;
  read?: (prompt: string) => Promise<string>;
  eventIdFactory?: () => string;
  artifactIdFactory?: () => string;
  timezoneEpochIdFactory?: () => string;
  startServer?: (options: StartBand8ServerOptions) => Promise<RunningBand8Server>;
  waitForShutdown?: (running: RunningBand8Server) => Promise<void>;
  openBrowser?: (url: string) => void;
  now?: () => string;
}

interface ParsedArguments {
  workspace: string;
  command: string;
  targets: string[];
  protectedPath?: string;
  sessionId?: string;
  port?: number;
  noOpen: boolean;
}

function takeOption(argumentsList: string[], name: string): string | undefined {
  const index = argumentsList.indexOf(name);
  if (index < 0) return undefined;
  const value = argumentsList[index + 1];
  if (value === undefined) throw new Error(`${name} requires a value`);
  argumentsList.splice(index, 2);
  return value;
}

function takeFlag(argumentsList: string[], name: string): boolean {
  const index = argumentsList.indexOf(name);
  if (index < 0) return false;
  argumentsList.splice(index, 1);
  return true;
}

function parseArguments(argumentsList: string[]): ParsedArguments {
  const remaining = [...argumentsList];
  const workspace = takeOption(remaining, "--workspace");
  const protectedPath = takeOption(remaining, "--protected");
  const sessionId = takeOption(remaining, "--session");
  const portText = takeOption(remaining, "--port");
  const noOpen = takeFlag(remaining, "--no-open");
  const [command, ...targets] = remaining;
  if (workspace === undefined || command === undefined) {
    throw new Error("usage: band8 --workspace <path> <serve|validate|import|run|checkpoint|continue|reinforce|reveal|mission|timezone> [target...] [--port <port>] [--no-open]");
  }
  if (!["serve", "validate", "import", "run", "checkpoint", "continue", "reinforce", "reveal", "mission", "timezone"].includes(command)) throw new Error(`unknown command: ${command}`);
  let port: number | undefined;
  if (portText !== undefined) {
    port = Number(portText);
    if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error("--port must be an integer from 0 to 65535");
  }
  if (command === "serve") {
    if (targets.length !== 0) throw new Error("serve does not accept target arguments");
  } else if (command === "timezone") {
    const operation = targets[0];
    if (operation === "get" && targets.length !== 1) throw new Error("timezone get requires no value");
    if (["set", "change"].includes(operation ?? "") && targets.length !== 2) throw new Error(`timezone ${operation} requires one value`);
    if (!["get", "set", "change"].includes(operation ?? "")) throw new Error(`unknown timezone operation: ${operation ?? ""}`);
  } else {
    const expectedTargets = command === "continue" || command === "reinforce" ? 2 : 1;
    if (targets.length !== expectedTargets) throw new Error(`${command} requires ${expectedTargets} target argument(s)`);
  }
  return {
    workspace: resolve(workspace),
    command,
    targets,
    ...(protectedPath === undefined ? {} : { protectedPath: resolve(protectedPath) }),
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(port === undefined ? {} : { port }),
    noOpen,
  };
}

function openFixedLocalUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1") throw new Error("refusing to open a non-loopback URL");
  const command = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", parsed.href] : [parsed.href];
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
}

async function waitForServerShutdown(running: RunningBand8Server): Promise<void> {
  await new Promise<void>((resolveShutdown, reject) => {
    let stopping = false;
    const cleanup = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    };
    const stop = () => {
      if (stopping) return;
      stopping = true;
      cleanup();
      running.close().then(resolveShutdown, reject);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

async function terminalRead(prompt: string): Promise<string> {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await terminal.question(prompt);
  } finally {
    terminal.close();
  }
}

export async function executeCli(argumentsList: string[], dependencies: CliDependencies = {}): Promise<number> {
  const parsed = parseArguments(argumentsList);
  const repositoryRoot = dependencies.repositoryRoot ?? resolve(process.cwd());
  const write = dependencies.write ?? ((value: string) => process.stdout.write(`${value}\n`));
  const read = dependencies.read ?? terminalRead;
  if (parsed.command === "validate") {
    const packageDocument = parseJsonStrict(readFileSync(resolve(parsed.targets[0]!), "utf8"));
    const validator = createProtocolValidator(repositoryRoot);
    validator.validatePackage(packageDocument);
    if (parsed.protectedPath !== undefined) {
      const protectedDocument = parseJsonStrict(readFileSync(parsed.protectedPath, "utf8"));
      validator.validateProtectedEvaluation(protectedDocument, packageDocument);
    }
    write("VALID");
    return 0;
  }

  const runtimeOptions = {
    repositoryRoot,
    workspacePath: parsed.workspace,
    ...(dependencies.eventIdFactory === undefined ? {} : { eventIdFactory: dependencies.eventIdFactory }),
    ...(dependencies.artifactIdFactory === undefined ? {} : { artifactIdFactory: dependencies.artifactIdFactory }),
    ...(dependencies.timezoneEpochIdFactory === undefined ? {} : { timezoneEpochIdFactory: dependencies.timezoneEpochIdFactory }),
    ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
  };
  const runtime = Band8Runtime.open(runtimeOptions);
  if (parsed.command === "serve") {
    const running = await (dependencies.startServer ?? startBand8Server)({
      repositoryRoot,
      workspacePath: parsed.workspace,
      port: parsed.port ?? 0,
    });
    write("Band8 local server");
    write("");
    write("Workspace:");
    write(parsed.workspace);
    write("");
    write("Learning timezone:");
    write(runtime.learningTimezone()?.learning_timezone ?? "NOT_CONFIGURED");
    write("");
    write("Open:");
    write(running.url);
    if (!parsed.noOpen) (dependencies.openBrowser ?? openFixedLocalUrl)(running.url);
    await (dependencies.waitForShutdown ?? waitForServerShutdown)(running);
    return 0;
  }
  if (parsed.command === "timezone") {
    const operation = parsed.targets[0]!;
    if (operation === "get") {
      const settings = runtime.learningTimezone();
      write(settings === undefined ? "UNCONFIGURED" : canonicalJson(settings));
      return 0;
    }
    const epoch = operation === "set"
      ? runtime.configureLearningTimezone(parsed.targets[1]!)
      : runtime.changeLearningTimezone(parsed.targets[1]!);
    write(`${operation === "set" ? "CONFIGURED" : "CHANGED"} ${epoch.learning_timezone} ${epoch.timezone_epoch_id}`);
    return 0;
  }
  if (parsed.command === "reinforce") {
    if (parsed.targets[0] !== "evaluate") throw new Error("reinforce requires the evaluate operation");
    write(canonicalJson(runtime.evaluateReinforcement(parsed.targets[1]!)));
    return 0;
  }
  if (parsed.command === "reveal") {
    write(canonicalJson(runtime.reveal(parsed.targets[0]!)));
    return 0;
  }
  if (parsed.command === "mission") {
    write(canonicalJson(runtime.mission(parsed.targets[0]!)));
    return 0;
  }
  if (parsed.command === "import") {
    const packageText = readFileSync(resolve(parsed.targets[0]!), "utf8");
    const protectedText = parsed.protectedPath === undefined ? undefined : readFileSync(parsed.protectedPath, "utf8");
    const result = protectedText === undefined
      ? runtime.importPackage(packageText)
      : runtime.importPackage(packageText, protectedText);
    write(`${result.status} ${result.packageId} ${result.canonicalHash}`);
    return 0;
  }

  if (parsed.command === "checkpoint") {
    const exported = runtime.exportCheckpoint(parsed.targets[0]!);
    write(`DATA_ONLY ${exported.bundlePath}`);
    return 0;
  }

  if (parsed.command === "continue") {
    const result = runtime.attachContinuation(parsed.targets[0]!, readFileSync(resolve(parsed.targets[1]!), "utf8"));
    write(`${result.status} ${result.packageId} ${result.sessionId}`);
    return 0;
  }

  const sessionId = parsed.sessionId ?? `session-${randomUUID()}`;
  runtime.createSession(parsed.targets[0]!, sessionId);
  runtime.startSession(sessionId);
  while (runtime.getSession(sessionId).state === "RUNNING") {
    const activity = runtime.currentActivity(sessionId);
    write(canonicalJson(activity));
    if (activity.type === "SELECT") {
      const answer = await read("Select option ID(s), comma-separated: ");
      runtime.completeCurrentActivity(sessionId, { optionIds: answer.split(",").map((item) => item.trim()).filter(Boolean) });
    } else if (activity.type === "TEXT_RESPONSE") {
      runtime.completeCurrentActivity(sessionId, { text: await read("Enter text response: ") });
    } else {
      await read("Press Enter to continue: ");
      runtime.completeCurrentActivity(sessionId);
    }
  }
  if (runtime.getSession(sessionId).state === "AWAITING_COACH") {
    write(`AWAITING_COACH ${sessionId}`);
    return 0;
  }
  const result = runtime.rebuildResult(sessionId);
  write(`COMPLETED ${sessionId}`);
  write(canonicalJson(result));
  return 0;
}

const directEntry = process.argv[1] === undefined ? undefined : pathToFileURL(resolve(process.argv[1])).href;
if (directEntry === import.meta.url) {
  executeCli(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
