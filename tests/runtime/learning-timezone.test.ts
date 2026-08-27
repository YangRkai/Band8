import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LearningTimezoneStore } from "../../src/storage/learning-timezone-store.js";
import { initializeWorkspace } from "../../src/storage/workspace.js";

const workspaces: string[] = [];

function workspace(): string {
  const path = mkdtempSync(join(tmpdir(), "band8-learning-timezone-"));
  workspaces.push(path);
  return path;
}

function clock(...timestamps: string[]): () => string {
  let index = 0;
  return () => timestamps[Math.min(index++, timestamps.length - 1)]!;
}

afterEach(() => {
  for (const path of workspaces.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("Runtime-owned learning timezone", () => {
  it("uses the Asia/Shanghai local calendar boundary instead of the UTC date", () => {
    const store = new LearningTimezoneStore(
      initializeWorkspace(workspace()),
      clock("2026-08-27T00:00:00.000Z", "2026-08-27T00:00:01.000Z", "2026-08-27T00:00:02.000Z"),
      () => "timezone-epoch-shanghai",
    );
    store.configure("Asia/Shanghai");

    const before = store.assignLearningDay({ sessionId: "session-before", completedAt: "2026-08-27T15:59:59.000Z" });
    const after = store.assignLearningDay({ sessionId: "session-after", completedAt: "2026-08-27T16:00:00.000Z" });

    expect(before.local_calendar_date).toBe("2026-08-27");
    expect(after.local_calendar_date).toBe("2026-08-28");
    expect(before.timezone_epoch_id).toBe("timezone-epoch-shanghai");
  });

  it("uses the America/Los_Angeles midnight boundary across one UTC date", () => {
    const store = new LearningTimezoneStore(
      initializeWorkspace(workspace()),
      clock("2026-08-26T00:00:00.000Z", "2026-08-26T00:00:01.000Z", "2026-08-26T00:00:02.000Z"),
      () => "timezone-epoch-los-angeles",
    );
    store.configure("America/Los_Angeles");

    const before = store.assignLearningDay({ sessionId: "session-before", completedAt: "2026-08-27T06:59:59.000Z" });
    const after = store.assignLearningDay({ sessionId: "session-after", completedAt: "2026-08-27T07:00:00.000Z" });

    expect(before.local_calendar_date).toBe("2026-08-26");
    expect(after.local_calendar_date).toBe("2026-08-27");
  });

  it("keeps one local date for timestamps on different UTC dates", () => {
    const store = new LearningTimezoneStore(
      initializeWorkspace(workspace()),
      clock("2026-08-27T00:00:00.000Z", "2026-08-27T00:00:01.000Z", "2026-08-27T00:00:02.000Z"),
      () => "timezone-epoch-shanghai",
    );
    store.configure("Asia/Shanghai");

    expect(store.assignLearningDay({ sessionId: "session-one", completedAt: "2026-08-27T16:30:00.000Z" }).local_calendar_date)
      .toBe("2026-08-28");
    expect(store.assignLearningDay({ sessionId: "session-two", completedAt: "2026-08-28T15:30:00.000Z" }).local_calendar_date)
      .toBe("2026-08-28");
  });

  it("appends an epoch and never re-keys an existing session day", () => {
    const path = workspace();
    const ids = ["timezone-epoch-one", "timezone-epoch-two"];
    const store = new LearningTimezoneStore(
      initializeWorkspace(path),
      clock(
        "2026-08-27T00:00:00.000Z",
        "2026-08-27T01:00:00.000Z",
        "2026-08-28T00:00:00.000Z",
        "2026-08-28T01:00:00.000Z",
      ),
      () => ids.shift()!,
    );
    const first = store.configure("Asia/Shanghai");
    const historical = store.assignLearningDay({ sessionId: "session-historical", completedAt: "2026-08-27T12:00:00.000Z" });
    const second = store.change("America/Los_Angeles");
    const future = store.assignLearningDay({ sessionId: "session-future", completedAt: "2026-08-28T12:00:00.000Z" });
    const repeated = store.assignLearningDay({ sessionId: "session-historical", completedAt: "2026-08-27T12:00:00.000Z" });

    expect(first.timezone_epoch_id).toBe("timezone-epoch-one");
    expect(second.timezone_epoch_id).toBe("timezone-epoch-two");
    expect(historical.learning_day_id).toBe("timezone-epoch-one:2026-08-27");
    expect(future.learning_day_id).toBe("timezone-epoch-two:2026-08-28");
    expect(repeated).toEqual(historical);

    const reopened = new LearningTimezoneStore(initializeWorkspace(path), () => "2026-08-29T00:00:00.000Z", () => "unused");
    expect(reopened.read()).toEqual({
      version: 1,
      learning_timezone: "America/Los_Angeles",
      timezone_epoch_id: "timezone-epoch-two",
      epochs: [first, second],
    });
    expect(reopened.listLearningDays()).toEqual([historical, future]);
  });

  it("rejects unsupported IANA identifiers and fixed UTC offsets", () => {
    const store = new LearningTimezoneStore(
      initializeWorkspace(workspace()),
      () => "2026-08-27T00:00:00.000Z",
      () => "timezone-epoch-invalid",
    );

    expect(() => store.configure("Mars/Olympus_Mons")).toThrow(/IANA learning timezone/iu);
    expect(() => store.configure("+08:00")).toThrow(/IANA learning timezone/iu);
  });

  it("rejects a session identity collision instead of changing historical day identity", () => {
    const store = new LearningTimezoneStore(
      initializeWorkspace(workspace()),
      clock("2026-08-27T00:00:00.000Z", "2026-08-27T00:00:01.000Z"),
      () => "timezone-epoch-one",
    );
    store.configure("Asia/Shanghai");
    store.assignLearningDay({ sessionId: "session-stable", completedAt: "2026-08-27T12:00:00.000Z" });

    expect(() => store.assignLearningDay({ sessionId: "session-stable", completedAt: "2026-08-28T12:00:00.000Z" }))
      .toThrow(/learning-day identity collision/iu);
  });
});
