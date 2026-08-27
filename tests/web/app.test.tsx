import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import {
  CoachView,
  HistoryView,
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
    ["AUDIO_CAPTURE", "UNSUPPORTED_RUNTIME_PRIMITIVE"],
  ])("renders %s without deriving domain truth", (type, expected) => {
    const html = renderToStaticMarkup(<TrainingActivityView
      activity={{
        activity_id: "activity-one",
        type,
        prompt: "<script>alert(1)</script>",
        config: type === "SELECT"
          ? { selection_mode: "one", options: [{ option_id: "one", label: "Option one" }], min_selections: 1, max_selections: 1 }
          : type === "TEXT_RESPONSE" ? { min_characters: 1, max_characters: 500, artifact_type: "essay" } : {},
        resources: type === "PRESENT_TEXT" ? [{ resource_id: "resource-one", content_format: "plain_text", content: "Synthetic passage" }] : [],
        accessibility: { keyboard_operable: true, screen_reader_label: "Activity" },
      }}
      busy={false}
      onSubmit={async () => undefined}
    />);

    expect(html).toContain(expected);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("dangerouslySetInnerHTML");
  });

  it("shows one evidence-linked reveal surface without reward noise", () => {
    const html = renderToStaticMarkup(<RevealView value={{
      primary_event: { event_type: "MISSION_ADVANCED", evidence_refs: ["event-one"] },
      supporting_events: [{ event_type: "STREAK_EXTENDED", evidence_refs: ["event-two"] }],
      evidence_refs: ["event-one", "event-two"],
      qualification_change: null,
    }} />);
    expect(html).toContain("MISSION ADVANCED");
    expect(html).toContain("STREAK EXTENDED");
    expect(html).toContain("Validation pending");
    expect(html).not.toMatch(/XP|coin|badge|loot/iu);
  });

  it("stops a quarantined session without offering a training action", () => {
    const html = renderToStaticMarkup(<TrainingIdleView value={{ state: "QUARANTINED" }} onStart={() => undefined} onNavigate={() => undefined} />);
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
});
