import { ProtocolValidationError } from "./validator.js";

type Document = Record<string, any>;

function sameSet(left: unknown[], right: unknown[]): boolean {
  return left.length === right.length && left.every((item) => right.includes(item));
}

function expectedOutcome(submission: Document, entry: Document): "successful" | "unsuccessful" {
  const payload = submission.payload as Document;
  if (entry.scoring_rule === "exact_option_set") {
    return sameSet(payload.option_ids ?? [], entry.correct_option_ids) ? "successful" : "unsuccessful";
  }
  if (entry.scoring_rule === "normalized_text_set") {
    const normalize = (value: string) => value.toLocaleLowerCase("en").trim().replace(/\s+/gu, " ");
    return entry.accepted_texts.map(normalize).includes(normalize(payload.text_value ?? "")) ? "successful" : "unsuccessful";
  }
  if (entry.scoring_rule === "exact_order") {
    return JSON.stringify(payload.ordered_item_ids ?? []) === JSON.stringify(entry.expected_order) ? "successful" : "unsuccessful";
  }
  return JSON.stringify(payload.pairs ?? []) === JSON.stringify(entry.expected_pairs) ? "successful" : "unsuccessful";
}

export function validateResultSemantics(
  result: Document,
  events: Document[],
  packageDocument: Document,
  protectedEvaluation: Document,
): void {
  const first = events[0];
  const terminal = events.at(-1);
  if (first === undefined || terminal === undefined) throw new ProtocolValidationError("result evidence is empty");
  if ([result.session_id, result.run_id, result.segment_id, result.package_id].join("|") !== [first.session_id, first.run_id, first.segment_id, first.package_id].join("|")) {
    throw new ProtocolValidationError("session result context does not match evidence");
  }
  const eventIds = events.map((event) => event.event_id);
  if (!sameSet(result.source_event_ids, eventIds)) throw new ProtocolValidationError("result does not cite complete event stream");
  if (!sameSet(result.activities_completed, terminal.payload.completed_activity_ids ?? [])) throw new ProtocolValidationError("result completion does not match terminal evidence");
  const submissions = new Map(events.filter((event) => event.event_type === "answer_submitted").map((event) => [event.activity_id, event]));
  const results = new Map<string, Document>(result.objective_results.map((item: Document) => [item.activity_id as string, item]));
  if (!sameSet([...results.keys()], protectedEvaluation.entries.map((entry: Document) => entry.activity_id))) throw new ProtocolValidationError("objective result coverage differs from protected evaluation");
  for (const entry of protectedEvaluation.entries as Document[]) {
    const submission = submissions.get(entry.activity_id);
    const item = results.get(entry.activity_id);
    if (submission === undefined || item === undefined || !item.evidence_refs.includes(submission.event_id)) throw new ProtocolValidationError("objective result lacks submitted evidence");
    if (item.outcome !== expectedOutcome(submission, entry)) throw new ProtocolValidationError("objective result outcome is not derived from protected evidence");
    if (item.performance_class !== packageDocument.session_intent.evidence_class) throw new ProtocolValidationError("objective performance class mismatch");
  }
}
