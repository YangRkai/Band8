import type { AuthoritativeSessionEvidence } from "./types.js";
import { epochMilliseconds, utcDay } from "./time.js";

export interface EffectiveStreakProjection {
  policy_version: "0.1.0";
  day_boundary: "UTC";
  effective_days: string[];
  current_streak: number;
  best_streak: number;
  total_effective_days: number;
}

function dayNumber(day: string): number {
  return Math.floor(epochMilliseconds(`${day}T00:00:00.000Z`) / 86_400_000);
}

export function projectEffectiveStreak(
  sessions: readonly AuthoritativeSessionEvidence[],
  evaluatedAt: string,
): EffectiveStreakProjection {
  const seenSessions = new Set<string>();
  const days = new Set<string>();
  for (const session of sessions) {
    if (seenSessions.has(session.sessionId)) continue;
    seenSessions.add(session.sessionId);
    if (!session.hasLegitimateParticipation || session.clockAnomaly) continue;
    days.add(utcDay(session.completedAt));
  }
  const effectiveDays = [...days].sort();
  let best = 0;
  let run = 0;
  let previous: number | undefined;
  for (const day of effectiveDays) {
    const current = dayNumber(day);
    run = previous !== undefined && current === previous + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    previous = current;
  }
  const evaluatedDay = utcDay(evaluatedAt);
  const latestDay = effectiveDays.at(-1);
  let currentStreak = 0;
  if (latestDay !== undefined && dayNumber(evaluatedDay) - dayNumber(latestDay) <= 1) {
    currentStreak = 1;
    for (let index = effectiveDays.length - 1; index > 0; index -= 1) {
      if (dayNumber(effectiveDays[index]!) !== dayNumber(effectiveDays[index - 1]!) + 1) break;
      currentStreak += 1;
    }
  }
  return {
    policy_version: "0.1.0",
    day_boundary: "UTC",
    effective_days: effectiveDays,
    current_streak: currentStreak,
    best_streak: best,
    total_effective_days: effectiveDays.length,
  };
}
