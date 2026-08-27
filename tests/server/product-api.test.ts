import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { startBand8Server, type RunningBand8Server } from "../../src/server/server.js";
import { storageKey } from "../../src/storage/workspace.js";

type Document = Record<string, any>;

const repositoryRoot = resolve(process.cwd());
const readingPackage = JSON.parse(readFileSync(resolve(repositoryRoot, "tests/runtime/fixtures/reading-golden/training-package.json"), "utf8")) as Document;
const readingProtected = JSON.parse(readFileSync(resolve(repositoryRoot, "tests/runtime/fixtures/reading-golden/protected-evaluation.json"), "utf8")) as Document;
const writingPackage = JSON.parse(readFileSync(resolve(repositoryRoot, "tests/runtime/fixtures/writing-golden/package-a.json"), "utf8")) as Document;
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
  const running = await startBand8Server({ repositoryRoot, workspacePath, port: 0 });
  servers.push(running);
  const html = await (await fetch(running.url)).text();
  const token = html.match(/<meta name="band8-session" content="([^"]+)">/u)?.[1];
  if (token === undefined) throw new Error("missing local session token");
  return { running, token, workspacePath };
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
