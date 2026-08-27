import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { createProtocolValidator } from "../../src/protocol/validator.js";
import { collectAuthoritativeEvidence } from "../../src/reinforcement/evidence.js";
import type { ReinforcementEvidenceSource } from "../../src/reinforcement/types.js";

type Document = Record<string, any>;

const repositoryRoot = resolve(process.cwd());

function fixture(path: string): Document {
  return JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8")) as Document;
}

function completedReadingSource(overrides: Partial<ReinforcementEvidenceSource> = {}): ReinforcementEvidenceSource {
  const packageDocument = fixture("tests/runtime/fixtures/reading-golden/training-package.json");
  const completed = {
    event_id: "event-reading-completed",
    event_type: "session_completed",
    timestamp: "2026-08-27T10:00:00.000Z",
    payload: { completed_activity_ids: packageDocument.completion_policy.required_activity_ids },
  };
  return {
    inspectionStatus: "AUTHORITATIVE",
    session: {
      session_id: "session-reading-one",
      run_id: packageDocument.run_id,
      segment_id: packageDocument.segment_id,
      package_id: packageDocument.package_id,
      state: "COMPLETED",
    },
    packageDocument,
    result: {
      completed_at: completed.timestamp,
      objective_results: [
        {
          result_id: "result-reading-one",
          activity_id: "activity-runtime-select-1",
          performance_class: "training_performance",
          outcome: "successful",
          evidence_refs: ["event-reading-answer"],
        },
      ],
      self_assessments: [],
    },
    events: [
      {
        event_id: "event-reading-answer",
        event_type: "answer_submitted",
        activity_id: "activity-runtime-select-1",
        timestamp: "2026-08-27T09:59:00.000Z",
        payload: { response_kind: "selection", option_ids: ["true"] },
      },
      completed,
    ],
    ...overrides,
  };
}

describe("authoritative reinforcement evidence", () => {
  it("collects objective outcomes, participation, skill, resource hash, and completion only from authoritative sessions", () => {
    const collected = collectAuthoritativeEvidence([completedReadingSource()]);

    expect(collected).toHaveLength(1);
    expect(collected[0]).toMatchObject({
      sessionId: "session-reading-one",
      state: "COMPLETED",
      evidenceClass: "training_performance",
      completedAt: "2026-08-27T10:00:00.000Z",
      hasLegitimateParticipation: true,
      clockAnomaly: false,
    });
    expect(collected[0]?.observations).toEqual([
      expect.objectContaining({
        evidenceRef: "event-reading-answer",
        outcome: "successful",
        skillId: "reading.explicit-detail",
        resourceHashes: ["sha256:ee65cb45134eff3c6e4d7e803d143ebb1c18107d86cbe051c7446c3365ccc559"],
      }),
    ]);
  });

  it("excludes non-authoritative and replayed identities and never treats self-rating or Coach claims as successful evidence", () => {
    const authoritative = completedReadingSource();
    authoritative.result!.self_assessments = [{ evidence_ref: "self-rating-excellent", value: "excellent" }];
    authoritative.packageDocument.generator.producer = "External Codex Coach";
    authoritative.packageDocument.training_rationale.summary = "breakthrough and mastery";
    const duplicate = completedReadingSource({
      session: { ...authoritative.session },
      result: { ...authoritative.result },
    });
    const quarantined = completedReadingSource({
      inspectionStatus: "QUARANTINED",
      session: { ...authoritative.session, session_id: "session-quarantined", state: "QUARANTINED" },
    });

    const collected = collectAuthoritativeEvidence([authoritative, duplicate, quarantined]);

    expect(collected).toHaveLength(1);
    expect(JSON.stringify(collected)).not.toMatch(/excellent|breakthrough|mastery|self-rating/iu);
  });

  it("validates the frozen historical award and rejects the easy-repetition reward-hacking fixture", () => {
    const validator = createProtocolValidator(repositoryRoot);
    const award = fixture("tests/protocol/fixtures/adversarial/pattern-broken-regression/historical-award.json");
    const hacking = fixture("tests/protocol/fixtures/adversarial/reward-hacking-easy-repetition.json");

    expect(() => validator.validateReinforcementDecision(award)).not.toThrow();
    expect(() => validator.validateReinforcementDecision(hacking)).toThrow(/two earlier sessions/iu);
  });

  it("resolves the unique same-activity submission even when it is not the first result reference", () => {
    const source = completedReadingSource();
    source.result!.objective_results[0].evidence_refs = ["unrelated-reference", "event-reading-answer"];
    source.events.unshift({
      event_id: "unrelated-reference",
      event_type: "activity_completed",
      activity_id: "activity-runtime-select-1",
      timestamp: "2026-08-20T00:00:00.000Z",
      payload: {},
    });
    const collected = collectAuthoritativeEvidence([source]);
    expect(collected[0]!.observations[0]).toMatchObject({
      evidenceRef: "event-reading-answer",
      occurredAt: "2026-08-27T09:59:00.000Z",
    });
  });

  it("leaves pattern identity unresolved for a multi-skill package with one hypothesis", () => {
    const source = completedReadingSource();
    source.packageDocument.training_hypotheses = [{ hypothesis_id: "hypothesis-reading-boundary", purpose: "test" }];
    source.packageDocument.target_skills = ["reading.explicit-detail", "reading.not-given"];
    const collected = collectAuthoritativeEvidence([source]);
    expect(collected[0]!.observations[0]!.errorPatternId).toBeUndefined();
    expect(collected[0]!.interventions).toEqual([]);
  });
});
