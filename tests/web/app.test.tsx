import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";
import type { LearnerActivityDto } from "../../src/product-api/dto.js";

import {
  CoachView,
  HistoryView,
  mergeHistoryPages,
  Navigation,
  ProgressView,
  RevealView,
  TodayView,
  TrainingActivityView,
  TrainingIdleView,
} from "../../web/src/app.js";

describe("Band8 product shell presentation", () => {
  it("keeps the primary navigation and truthful empty Today focused", () => {
    const navigation = renderToStaticMarkup(<Navigation current="today" />);
    const today = renderToStaticMarkup(<TodayView value={{
      empty: true,
      goal: { overall_target: 8, section_minimums: { listening: 7.5, reading: 7.5, writing: 7.5, speaking: 7.5 } },
      mission: null,
      effective_streak: null,
      last_reveal: null,
      coach_status: "NO_PACKAGE",
      primary_action: "GO_TO_COACH",
    }} onNavigate={() => undefined} />);

    expect(navigation).toContain("TODAY");
    expect(navigation).toContain("TRAIN");
    expect(navigation).toContain("PROGRESS");
    expect(navigation).toContain("HISTORY");
    expect(navigation).toContain("COACH");
    expect(today).toContain("Overall ≥ 8.0");
    expect(today).toContain("No training package yet.");
    expect(today).not.toMatch(/73%|estimated|fake mission/iu);
  });

  it.each([
    ["INSTRUCTION", "Continue"],
    ["PRESENT_TEXT", "Synthetic passage"],
    ["SELECT", "Option one"],
    ["TEXT_RESPONSE", "Word count"],
    ["UNSUPPORTED_RUNTIME_PRIMITIVE", "UNSUPPORTED_RUNTIME_PRIMITIVE"],
  ] as const)("renders %s without deriving domain truth", (type, expected) => {
    const base = {
      activity_id: "activity-one",
      prompt: "<script>alert(1)</script>",
      resources: type === "PRESENT_TEXT" ? [{ resource_id: "resource-one", content_format: "plain_text", content: "Synthetic passage" }] : [],
      accessibility: { keyboard_operable: true, screen_reader_label: "Activity" },
    };
    const activity: LearnerActivityDto = type === "SELECT"
      ? { ...base, type, config: { selection_mode: "one", options: [{ option_id: "one", label: "Option one" }], min_selections: 1, max_selections: 1 } }
      : type === "TEXT_RESPONSE"
        ? { ...base, type, config: { response_kind: "text", min_characters: 1, max_characters: 500, artifact_type: "essay" } }
        : type === "INSTRUCTION"
          ? { ...base, type, config: { acknowledge_required: true } }
          : type === "PRESENT_TEXT"
            ? { ...base, type, config: { display_mode: "passage" } }
            : { ...base, type, primitive_type: "AUDIO_CAPTURE", config: {} };
    const html = renderToStaticMarkup(<TrainingActivityView
      activity={activity}
      busy={false}
      onSubmit={async () => undefined}
    />);

    expect(html).toContain(expected);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("dangerouslySetInnerHTML");
  });

  it("shows one evidence-linked reveal surface without reward noise", () => {
    const html = renderToStaticMarkup(<RevealView value={{
      policy_version: "0.1.0",
      session_id: "session-one",
      primary_event: { event_type: "MISSION_ADVANCED", evidence_refs: ["event-one"], policy_version: "0.1.0", semantic_id: "reward-one" },
      supporting_events: [{ event_type: "STREAK_EXTENDED", evidence_refs: ["event-two"], policy_version: "0.1.0", semantic_id: "reward-two" }],
      evidence_refs: ["event-one", "event-two"],
      qualification_change: null,
      presentation: {
        title: "MISSION ADVANCED",
        message: "Runtime-projected validation message.",
        validation_label: "VALIDATION PENDING",
        qualification_label: null,
      },
    }} />);
    expect(html).toContain("MISSION ADVANCED");
    expect(html).toContain("STREAK EXTENDED");
    expect(html).toContain("Runtime-projected validation message.");
    expect(html).toContain("VALIDATION PENDING");
    expect(html).not.toMatch(/XP|coin|badge|loot/iu);
  });

  it("renders only the section targets explicitly supplied by the Runtime goal DTO", () => {
    const html = renderToStaticMarkup(<TodayView value={{
      empty: true,
      goal: { overall_target: 8.5, section_minimums: { listening: 8, reading: 7.5 } },
      mission: null,
      effective_streak: null,
      last_reveal: null,
      coach_status: "NO_PACKAGE",
      primary_action: "GO_TO_COACH",
    }} onNavigate={() => undefined} />);

    expect(html).toContain("Overall ≥ 8.5");
    expect(html).toContain("Listening ≥ 8.0");
    expect(html).toContain("Reading ≥ 7.5");
    expect(html).not.toMatch(/Writing ≥|Speaking ≥|NaN/u);
  });

  it("uses Runtime-projected qualification presentation instead of deriving it from the reward event", () => {
    const html = renderToStaticMarkup(<RevealView value={{
      policy_version: "0.1.0",
      session_id: "session-one",
      primary_event: { event_type: "PATTERN_BROKEN", evidence_refs: ["event-one"], policy_version: "0.1.0", semantic_id: "reward-one" },
      supporting_events: [],
      evidence_refs: ["event-one"],
      qualification_change: { qualification: "revoked" },
      presentation: {
        title: "PATTERN BROKEN — HISTORICAL",
        message: "The historical award remains recorded.",
        validation_label: "NEEDS REVALIDATION",
        qualification_label: "CURRENT QUALIFICATION REVOKED",
      },
    }} />);

    expect(html).toContain("PATTERN BROKEN — HISTORICAL");
    expect(html).toContain("The historical award remains recorded.");
    expect(html).toContain("NEEDS REVALIDATION");
    expect(html).toContain("CURRENT QUALIFICATION REVOKED");
    expect(html).not.toContain("Qualification confirmed");
  });

  it("renders single and multi SELECT controls from Runtime min/max constraints", () => {
    const base = {
      activity_id: "activity-select",
      type: "SELECT" as const,
      prompt: "Select evidence",
      resources: [],
      accessibility: { keyboard_operable: true, screen_reader_label: "Select evidence" },
    };
    const single = renderToStaticMarkup(<TrainingActivityView activity={{
      ...base,
      config: { selection_mode: "one", options: [{ option_id: "one", label: "One" }], min_selections: 1, max_selections: 1 },
    }} busy={false} onSubmit={async () => undefined} />);
    const multiple = renderToStaticMarkup(<TrainingActivityView activity={{
      ...base,
      config: {
        selection_mode: "many",
        options: [{ option_id: "one", label: "One" }, { option_id: "two", label: "Two" }, { option_id: "three", label: "Three" }],
        min_selections: 2,
        max_selections: 2,
      },
    }} busy={false} onSubmit={async () => undefined} />);

    expect(single).toContain('type="radio"');
    expect(multiple).toContain('type="checkbox"');
    expect(multiple).toContain("disabled");
  });

  it("stops a quarantined session without offering a training action", () => {
    const html = renderToStaticMarkup(<TrainingIdleView value={{
      session_id: "session-quarantined",
      package_id: "package-one",
      state: "QUARANTINED",
      activity_number: 1,
      activity_count: 1,
      mission: null,
      current_activity: null,
      integrity: { status: "QUARANTINED" },
    }} onStart={() => undefined} onNavigate={() => undefined} />);
    expect(html).toContain("Evidence integrity issue detected.");
    expect(html).toContain("will not contribute to progress");
    expect(html).not.toContain("START TRAINING");
  });

  it("presents Coach as a checkpoint exchange rather than a chat or fake thinking state", () => {
    const html = renderToStaticMarkup(<CoachView value={{
      status: "REVIEW_REQUIRED",
      session_id: "session-writing",
      checkpoint_id: "checkpoint-writing",
      evidence_count: 1,
      evidence_refs: ["artifact-writing"],
      bundle_identity: "coach-bundle:checkpoint-writing",
    }} busy={false} onExport={async () => undefined} onImport={async () => undefined} onImportTraining={async () => undefined} />);
    expect(html).toContain("REVIEW REQUIRED");
    expect(html).toContain("EXPORT COACH BUNDLE");
    expect(html).toContain("IMPORT CONTINUATION");
    expect(html).not.toMatch(/thinking|chat/iu);
  });

  it("presents Runtime qualification and revalidation status without deriving mastery", () => {
    const html = renderToStaticMarkup(<ProgressView value={{
      goal: { overall_target: 8, section_minimums: { listening: 7.5, reading: 7.5, writing: 7.5, speaking: 7.5 } },
      missions: [],
      validated_qualifications: [{ skill_id: "reading.tfng", error_pattern_id: "pattern-one", qualification: "revoked" }],
      retention: "EVIDENCE_PENDING",
      transfer: "EVIDENCE_PENDING",
      pattern_status: "NEEDS_REVALIDATION",
    }} />);

    expect(html).toContain("VALIDATED QUALIFICATIONS");
    expect(html).toContain("revoked");
    expect(html).toContain("NEEDS REVALIDATION");
    expect(html).not.toMatch(/mastered|permanent/iu);
  });

  it("keeps paginated History reachable beyond the first Runtime page", () => {
    const html = renderToStaticMarkup(<HistoryView value={{ items: [], next_cursor: 20 }} busy={false} onLoadMore={async () => undefined} />);
    expect(html).toContain("LOAD MORE");
  });

  it("appends History pages by session identity without duplicating an overlapping row", () => {
    const item = (sessionId: string) => ({
      session_id: sessionId,
      state: "COMPLETED",
      objective: `Objective ${sessionId}`,
      target_skills: ["reading"],
      started_at: null,
      completed_at: null,
      submissions: [],
      artifacts: [],
      corrections: [],
      reveal: null,
      integrity: { status: "AUTHORITATIVE" },
    });
    const merged = mergeHistoryPages(
      { items: [item("session-1"), item("session-2")], next_cursor: 2 },
      { items: [item("session-2"), item("session-3")], next_cursor: null },
    );

    expect(merged.items.map((entry) => entry.session_id)).toEqual(["session-1", "session-2", "session-3"]);
    expect(merged.next_cursor).toBeNull();
  });
});
