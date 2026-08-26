#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";

import { canonicalJson, parseJsonStrict } from "../protocol/canonical.js";
import { createProtocolValidator } from "../protocol/validator.js";
import { Band8Runtime } from "../runtime/runtime.js";

interface CliDependencies {
  repositoryRoot?: string;
  write?: (value: string) => void;
  read?: (prompt: string) => Promise<string>;
  eventIdFactory?: () => string;
  now?: () => string;
}

interface ParsedArguments {
  workspace: string;
  command: string;
  target: string;
  protectedPath?: string;
  sessionId?: string;
}

function takeOption(argumentsList: string[], name: string): string | undefined {
  const index = argumentsList.indexOf(name);
  if (index < 0) return undefined;
  const value = argumentsList[index + 1];
  if (value === undefined) throw new Error(`${name} requires a value`);
  argumentsList.splice(index, 2);
  return value;
}

function parseArguments(argumentsList: string[]): ParsedArguments {
  const remaining = [...argumentsList];
  const workspace = takeOption(remaining, "--workspace");
  const protectedPath = takeOption(remaining, "--protected");
  const sessionId = takeOption(remaining, "--session");
  const [command, target, ...extras] = remaining;
  if (workspace === undefined || command === undefined || target === undefined || extras.length > 0) {
    throw new Error("usage: band8 --workspace <path> <validate|import|run> <target> [--protected <path>] [--session <id>]");
  }
  if (!["validate", "import", "run"].includes(command)) throw new Error(`unknown command: ${command}`);
  return {
    workspace: resolve(workspace),
    command,
    target,
    ...(protectedPath === undefined ? {} : { protectedPath: resolve(protectedPath) }),
    ...(sessionId === undefined ? {} : { sessionId }),
  };
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
    const packageDocument = parseJsonStrict(readFileSync(resolve(parsed.target), "utf8"));
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
    ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
  };
  const runtime = Band8Runtime.open(runtimeOptions);
  if (parsed.command === "import") {
    const packageText = readFileSync(resolve(parsed.target), "utf8");
    const protectedText = parsed.protectedPath === undefined ? undefined : readFileSync(parsed.protectedPath, "utf8");
    const result = protectedText === undefined
      ? runtime.importPackage(packageText)
      : runtime.importPackage(packageText, protectedText);
    write(`${result.status} ${result.packageId} ${result.canonicalHash}`);
    return 0;
  }

  const sessionId = parsed.sessionId ?? `session-${randomUUID()}`;
  runtime.createSession(parsed.target, sessionId);
  runtime.startSession(sessionId);
  while (runtime.getSession(sessionId).state === "RUNNING") {
    const activity = runtime.currentActivity(sessionId);
    write(canonicalJson(activity));
    if (activity.type === "SELECT") {
      const answer = await read("Select option ID(s), comma-separated: ");
      runtime.completeCurrentActivity(sessionId, { optionIds: answer.split(",").map((item) => item.trim()).filter(Boolean) });
    } else {
      await read("Press Enter to continue: ");
      runtime.completeCurrentActivity(sessionId);
    }
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
