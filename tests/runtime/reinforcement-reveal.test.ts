import { describe, expect, it } from "vitest";

import { projectReveal } from "../../src/reinforcement/reveal.js";
import type { EligibleReinforcementEvent } from "../../src/reinforcement/types.js";

function eligible(eventType: EligibleReinforcementEvent["event_type"], evidenceRef: string): EligibleReinforcementEvent {
  return {
    semantic_id: `reward-${eventType.toLocaleLowerCase().replaceAll("_", "-")}`,
    event_type: eventType,
    policy_version: "0.1.0",
    evidence_refs: [evidenceRef],
  };
}

describe("session progress reveal", () => {
  it("selects one primary event and orders supporting evidence by frozen priority", () => {
    const reveal = projectReveal({
      policy_version: "0.1.0",
      target_session_id: "session-reveal",
      evaluated_at: "2026-08-27T12:00:00.000Z",
      eligible: [
        eligible("SESSION_COMPLETE", "complete"),
        eligible("STREAK_EXTENDED", "streak"),
        eligible("TRANSFER_CONFIRMED", "transfer"),
        eligible("RETENTION_CONFIRMED", "retention"),
        eligible("PATTERN_BROKEN", "pattern"),
      ],
      rejected: [],
      currentQualification: { qualification: "confirmed", current_decision_id: "decision-pattern" },
      claims_mastery: false,
    });

    expect(reveal.primary_event?.event_type).toBe("PATTERN_BROKEN");
    expect(reveal.supporting_events.map((item) => item.event_type)).toEqual([
      "RETENTION_CONFIRMED",
      "TRANSFER_CONFIRMED",
      "STREAK_EXTENDED",
      "SESSION_COMPLETE",
    ]);
    expect(reveal.evidence_refs).toEqual(["complete", "pattern", "retention", "streak", "transfer"]);
    expect(reveal.qualification_change).toEqual({ qualification: "confirmed", current_decision_id: "decision-pattern" });
  });

  it("returns an empty presentation model when no event qualifies", () => {
    expect(projectReveal({
      policy_version: "0.1.0",
      target_session_id: "session-empty",
      evaluated_at: "2026-08-27T12:00:00.000Z",
      eligible: [],
      rejected: [{ event_type: "SESSION_COMPLETE", reason: "not_authoritative" }],
      claims_mastery: false,
    })).toEqual({
      policy_version: "0.1.0",
      session_id: "session-empty",
      primary_event: null,
      supporting_events: [],
      evidence_refs: [],
      qualification_change: null,
    });
  });
});
