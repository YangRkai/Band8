export type SessionState = "CREATED" | "READY" | "RUNNING" | "AWAITING_COACH" | "SUSPENDED" | "COMPLETED" | "ABORTED" | "QUARANTINED";

const legal: Record<SessionState, ReadonlySet<SessionState>> = {
  CREATED: new Set(["READY", "QUARANTINED"]),
  READY: new Set(["RUNNING", "QUARANTINED"]),
  RUNNING: new Set(["SUSPENDED", "AWAITING_COACH", "COMPLETED", "ABORTED", "QUARANTINED"]),
  AWAITING_COACH: new Set(["READY", "QUARANTINED"]),
  SUSPENDED: new Set(["RUNNING", "COMPLETED", "ABORTED", "QUARANTINED"]),
  COMPLETED: new Set(["QUARANTINED"]),
  ABORTED: new Set(["QUARANTINED"]),
  QUARANTINED: new Set(),
};

export function transitionState(current: SessionState, target: SessionState): SessionState {
  if (!legal[current].has(target)) {
    throw new Error(`illegal session transition: ${current} -> ${target}`);
  }
  return target;
}
