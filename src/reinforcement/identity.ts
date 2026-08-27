import { canonicalHash } from "../protocol/canonical.js";

export function reinforcementIdentity(policyVersion: string, eventType: string, evidenceRefs: readonly string[]): string {
  const digest = canonicalHash({
    policy_version: policyVersion,
    event_type: eventType,
    evidence_refs: [...new Set(evidenceRefs)].sort(),
  }).slice("sha256:".length, "sha256:".length + 32);
  return `reward-${digest}`;
}
