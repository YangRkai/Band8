import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { startBand8Server, type RunningBand8Server } from "../../src/server/server.js";
import { Band8Runtime } from "../../src/runtime/runtime.js";
import { storageKey } from "../../src/storage/workspace.js";
import { snapshotWorkspace } from "../helpers/workspace-snapshot.js";

type Document = Record<string, any>;

const repositoryRoot = resolve(process.cwd());
const readingPackage = JSON.parse(readFileSync(resolve(repositoryRoot, "tests/runtime/fixtures/reading-golden/training-package.json"), "utf8")) as Document;
const readingProtected = JSON.parse(readFileSync(resolve(repositoryRoot, "tests/runtime/fixtures/reading-golden/protected-evaluation.json"), "utf8")) as Document;
const writingPackage = JSON.parse(readFileSync(resolve(repositoryRoot, "tests/runtime/fixtures/writing-golden/package-a.json"), "utf8")) as Document;
const writingDraft = readFileSync(resolve(repositoryRoot, "tests/runtime/fixtures/writing-golden/draft.txt"), "utf8").trim();
const workspaces: string[] = [];
const servers: RunningBand8Server[] = [];

function workspace(): string {
  const temporaryRoot = join(repositoryRoot, ".tmp");
  mkdirSync(temporaryRoot, { recursive: true });
  const path = mkdtempSync(join(temporaryRoot, "band8-product-api-"));
  workspaces.push(path);
  return path;
}

async function open(): Promise<{ running: RunningBand8Server; token: string; workspacePath: string }> {
  const workspacePath = workspace();
  return await openWorkspace(workspacePath);
}

async function openWorkspace(workspacePath: string): Promise<{ running: RunningBand8Server; token: string; workspacePath: string }> {
  const running = await startBand8Server({ repositoryRoot, workspacePath, port: 0 });
  servers.push(running);
  const html = await (await fetch(running.url)).text();
  const token = html.match(/<meta name="band8-session" content="([^"]+)">/u)?.[1];
  if (token === undefined) throw new Error("missing local session token");
  return { running, token, workspacePath };
}

function prepareReading(workspacePath: string, sessionId: string): void {
  let event = 0;
  let second = 0;
  const runtime = Band8Runtime.open({
    repositoryRoot,
    workspacePath,
    eventIdFactory: () => `event-readonly-${++event}`,
    now: () => new Date(Date.UTC(2026, 7, 27, 12, 0, second++)).toISOString(),
    timezoneEpochIdFactory: () => "timezone-epoch-readonly",
  });
  runtime.configureLearningTimezone("Asia/Shanghai");
  runtime.importPackage(JSON.stringify(readingPackage), JSON.stringify(readingProtected));
  runtime.createSession(readingPackage.package_id, sessionId);
  runtime.startSession(sessionId);
  runtime.completeCurrentActivity(sessionId);
  runtime.completeCurrentActivity(sessionId);
  runtime.completeCurrentActivity(sessionId, { optionIds: ["true"] });
  runtime.completeCurrentActivity(sessionId, { optionIds: ["not-given"] });
}

async function post(running: RunningBand8Server, token: string, path: string, body: Document): Promise<Response> {
  return await fetch(`${running.url}${path}`, {
    method: "POST",
    headers: {
      origin: running.url,
      "content-type": "application/json",
      "x-band8-session": token,
    },
    body: JSON.stringify(body),
  });
}

afterEach(async () => {
  for (const running of servers.splice(0)) await running.close();
  for (const path of workspaces.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("learner-safe product API", () => {
  it.each(["today", "training", "progress"])("GET /%s does not persist a missing active selection", async (route) => {
    const workspacePath = workspace();
    const runtime = Band8Runtime.open({ repositoryRoot, workspacePath });
    runtime.importPackage(JSON.stringify(readingPackage), JSON.stringify(readingProtected));
    runtime.createSession(readingPackage.package_id, `session-readonly-${route}`);
    unlinkSync(join(workspacePath, "settings", "product-selection.json"));
    const before = snapshotWorkspace(workspacePath);
    const { running } = await openWorkspace(workspacePath);

    expect(snapshotWorkspace(workspacePath)).toEqual(before);

    const response = await fetch(`${running.url}/api/v1/${route}`);

    expect(response.status).toBe(200);
    expect(snapshotWorkspace(workspacePath)).toEqual(before);
  });

  it("GET /history projects quarantine without persisting session metadata", async () => {
    const workspacePath = workspace();
    const sessionId = "session-readonly-history";
    prepareReading(workspacePath, sessionId);
    writeFileSync(join(workspacePath, "sessions", storageKey(sessionId), "result.json"), "{}\n", "utf8");
    const { running } = await openWorkspace(workspacePath);
    const before = snapshotWorkspace(workspacePath);

    const response = await fetch(`${running.url}/api/v1/history?limit=20`);
    const payload = await response.json() as Document;

    expect(response.status).toBe(200);
    expect(payload.items[0]).toMatchObject({ session_id: sessionId, state: "QUARANTINED", integrity: { status: "QUARANTINED" } });
    expect(snapshotWorkspace(workspacePath)).toEqual(before);
  });

  it("all Product API GET routes remain byte-stable across ten projection rounds", async () => {
    const workspacePath = workspace();
    prepareReading(workspacePath, "session-readonly-repeated");
    const { running } = await openWorkspace(workspacePath);
    const routes = ["today", "training", "progress", "history?limit=20", "coach", "settings"];
    const before = snapshotWorkspace(workspacePath);
    let baseline: string[] | undefined;

    for (let round = 0; round < 10; round += 1) {
      const payloads: string[] = [];
      for (const route of routes) {
        const beforeRoute = snapshotWorkspace(workspacePath);
        const response = await fetch(`${running.url}/api/v1/${route}`);
        expect(response.status).toBe(200);
        payloads.push(JSON.stringify(await response.json()));
        expect(snapshotWorkspace(workspacePath)).toEqual(beforeRoute);
      }
      baseline ??= payloads;
      expect(payloads).toEqual(baseline);
    }

    expect(snapshotWorkspace(workspacePath)).toEqual(before);
  });

  it("recovers only a persisted checkpoint crash window before accepting GET traffic", async () => {
    const workspacePath = workspace();
    const sessionId = "session-readonly-checkpoint-recovery";
    let event = 0;
    let second = 0;
    const runtime = Band8Runtime.open({
      repositoryRoot,
      workspacePath,
      eventIdFactory: () => `event-checkpoint-recovery-${++event}`,
      artifactIdFactory: () => "artifact-checkpoint-recovery",
      now: () => new Date(Date.UTC(2026, 7, 27, 12, 0, second++)).toISOString(),
    });
    runtime.importPackage(JSON.stringify(writingPackage));
    runtime.createSession(writingPackage.package_id, sessionId);
    runtime.startSession(sessionId);
    runtime.completeCurrentActivity(sessionId);
    runtime.completeCurrentActivity(sessionId);
    const sessionPath = join(workspacePath, "sessions", storageKey(sessionId), "session.json");
    const metadataBeforeTerminalCheckpoint = readFileSync(sessionPath, "utf8");
    runtime.completeCurrentActivity(sessionId, { text: writingDraft });
    writeFileSync(sessionPath, metadataBeforeTerminalCheckpoint, "utf8");

    const { running } = await openWorkspace(workspacePath);
    const recovered = JSON.parse(readFileSync(sessionPath, "utf8")) as Document;
    const beforeGet = snapshotWorkspace(workspacePath);
    const response = await fetch(`${running.url}/api/v1/training`);

    expect(recovered).toMatchObject({ state: "AWAITING_COACH", checkpoint_id: "checkpoint-writing-golden" });
    expect(response.status).toBe(200);
    expect(snapshotWorkspace(workspacePath)).toEqual(beforeGet);
  });

  it("does not materialize reinforcement for an unmarked completed session during startup or GET", async () => {
    const workspacePath = workspace();
    const sessionId = "session-readonly-reinforcement-recovery";
    prepareReading(workspacePath, sessionId);
    const beforeStart = snapshotWorkspace(workspacePath);

    expect(beforeStart.some((entry) => entry.path.startsWith("reinforcement/learning-days/"))).toBe(false);

    const { running } = await openWorkspace(workspacePath);
    expect(snapshotWorkspace(workspacePath)).toEqual(beforeStart);
    const beforeGet = snapshotWorkspace(workspacePath);
    const response = await fetch(`${running.url}/api/v1/today`);

    expect(response.status).toBe(200);
    expect(snapshotWorkspace(workspacePath)).toEqual(beforeGet);
  });

  it("never serializes the absolute Runtime workspace root into learner-visible DTOs", async () => {
    const { running, workspacePath } = await open();
    const routes = ["today", "training", "progress", "history?limit=20", "coach", "settings"];
    const payloads = await Promise.all(routes.map(async (route) => await (await fetch(`${running.url}/api/v1/${route}`)).json()));
    const settings = payloads.at(-1);

    expect(settings).toEqual({
      storage: "LOCAL_RUNTIME_WORKSPACE",
      storage_mode: "LOCAL_ONLY",
      export_available: true,
      learning_timezone: null,
    });
    expect(JSON.stringify(payloads)).not.toContain(workspacePath);
    expect(JSON.stringify(payloads)).not.toMatch(/[A-Za-z]:\\\\|data_location|workspace_root/iu);
  });

  it("projects a truthful first-run empty Today without fabricating training", async () => {
    const { running } = await open();
    const response = await fetch(`${running.url}/api/v1/today`);
    const today = await response.json() as Document;

    expect(response.status).toBe(200);
    expect(today).toMatchObject({
      empty: true,
      goal: {
        overall_target: 8,
        section_minimums: { listening: 7.5, reading: 7.5, writing: 7.5, speaking: 7.5 },
      },
      mission: null,
      coach_status: "NO_PACKAGE",
      primary_action: "GO_TO_COACH",
    });
    expect(JSON.stringify(today)).not.toMatch(/fake|estimated_band|band_progress|correct_option|scoring_rule|band8-session/iu);
  });

  it("runs Reading through Runtime projections without leaking protected evaluation", async () => {
    const { running, token } = await open();
    expect((await post(running, token, "/api/v1/timezone", { operation: "configure", timeZone: "Asia/Shanghai" })).status).toBe(200);
    const imported = await post(running, token, "/api/v1/packages/import", {
      package: readingPackage,
      protectedEvaluation: readingProtected,
    });
    expect(imported.status).toBe(200);

    const started = await post(running, token, "/api/v1/sessions/start", { packageId: readingPackage.package_id });
    const training = await started.json() as Document;
    expect(started.status).toBe(200);
    expect(training).toMatchObject({
      state: "RUNNING",
      activity_number: 1,
      activity_count: 4,
      current_activity: { type: "INSTRUCTION" },
    });

    const completedInstruction = await post(running, token, "/api/v1/training/complete", { sessionId: training.session_id });
    expect(completedInstruction.status, await completedInstruction.clone().text()).toBe(200);
    const completedText = await post(running, token, "/api/v1/training/complete", { sessionId: training.session_id });
    expect(completedText.status, await completedText.clone().text()).toBe(200);
    const beforeSelect = await (await fetch(`${running.url}/api/v1/training`)).json() as Document;
    const serializedBefore = JSON.stringify(beforeSelect);
    expect(beforeSelect.current_activity.type).toBe("SELECT");
    expect(serializedBefore).not.toMatch(/correct_option_ids|scoring_rule|evaluation_id|integrity_ref/iu);

    const firstAnswer = await post(running, token, "/api/v1/training/complete", {
      sessionId: training.session_id,
      response: { optionIds: ["true"] },
    });
    expect(firstAnswer.status).toBe(200);
    const firstPayload = await firstAnswer.json() as Document;
    expect(JSON.stringify(firstPayload)).not.toMatch(/correct_option_ids|scoring_rule|integrity_ref/iu);
    expect(firstPayload.submission).toEqual({ activity_id: "activity-runtime-select-1" });

    const completed = await post(running, token, "/api/v1/training/complete", {
      sessionId: training.session_id,
      response: { optionIds: ["not-given"] },
    });
    const completion = await completed.json() as Document;
    expect(completed.status).toBe(200);
    expect(completion.state).toBe("COMPLETED");
    expect(completion.reveal.primary_event.event_type).toBe("MISSION_ADVANCED");
    expect(completion.reveal.supporting_events.map((item: Document) => item.event_type)).toEqual(["STREAK_EXTENDED", "SESSION_COMPLETE"]);

    const today = await (await fetch(`${running.url}/api/v1/today`)).json() as Document;
    expect(today).toMatchObject({
      empty: false,
      mission: { status: "VALIDATION_PENDING" },
      effective_streak: { total_effective_days: 1 },
      last_reveal: { primary_event: { event_type: "MISSION_ADVANCED" } },
    });
    const progress = await (await fetch(`${running.url}/api/v1/progress`)).json() as Document;
    const history = await (await fetch(`${running.url}/api/v1/history?limit=20`)).json() as Document;
    expect(progress.missions[0].status).toBe("VALIDATION_PENDING");
    expect(history.items[0]).toMatchObject({ session_id: training.session_id, state: "COMPLETED" });
    expect(JSON.stringify({ today, progress, history })).not.toMatch(/correct_option_ids|scoring_rule|integrity_ref|protected_file|package_file/iu);
  });

  it("projects a newly imported unstarted package instead of a completed prior session", async () => {
    const { running, token, workspacePath } = await open();
    await post(running, token, "/api/v1/timezone", { operation: "configure", timeZone: "Asia/Shanghai" });
    await post(running, token, "/api/v1/packages/import", { package: readingPackage, protectedEvaluation: readingProtected });
    const started = await (await post(running, token, "/api/v1/sessions/start", { packageId: readingPackage.package_id })).json() as Document;
    await post(running, token, "/api/v1/training/complete", { sessionId: started.session_id });
    await post(running, token, "/api/v1/training/complete", { sessionId: started.session_id });
    await post(running, token, "/api/v1/training/complete", { sessionId: started.session_id, response: { optionIds: ["true"] } });
    await post(running, token, "/api/v1/training/complete", { sessionId: started.session_id, response: { optionIds: ["not-given"] } });

    writeFileSync(join(workspacePath, "sessions", storageKey(started.session_id), "result.json"), "{}\n", "utf8");
    const quarantinedHistory = await (await fetch(`${running.url}/api/v1/history?limit=20`)).json() as Document;
    expect(quarantinedHistory.items[0]).toMatchObject({ session_id: started.session_id, state: "QUARANTINED" });

    await post(running, token, "/api/v1/packages/import", { package: writingPackage });
    const projection = await (await fetch(`${running.url}/api/v1/training`)).json() as Document;
    const today = await (await fetch(`${running.url}/api/v1/today`)).json() as Document;

    expect(projection).toMatchObject({ state: "READY_TO_START", package_id: writingPackage.package_id, session_id: null });
    expect(today).toMatchObject({ mission: { objective: writingPackage.session_intent.objective, status: "OPEN" } });
  });
});
