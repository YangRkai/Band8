import type {
  LearningDayRecord,
  LearningTimezoneSettings,
} from "../storage/learning-timezone-store.js";
import { localCalendarDate } from "../storage/learning-timezone-store.js";

export interface EffectiveDayProjection {
  learning_day_id: string;
  timezone_epoch_id: string;
  local_calendar_date: string;
}

export interface EffectiveStreakProjection {
  policy_version: "0.1.0";
  day_boundary: "LEARNING_TIMEZONE";
  learning_timezone: string;
  timezone_epoch_id: string;
  effective_days: EffectiveDayProjection[];
  current_streak: number;
  best_streak: number;
  total_effective_days: number;
}

function dayNumber(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  if (year === undefined || month === undefined || date === undefined) throw new Error(`invalid local calendar date: ${day}`);
  return Math.floor(Date.UTC(year, month - 1, date) / 86_400_000);
}

function longestRun(days: readonly string[]): number {
  let best = 0;
  let run = 0;
  let previous: number | undefined;
  for (const day of days) {
    const current = dayNumber(day);
    run = previous !== undefined && current === previous + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    previous = current;
  }
  return best;
}

export function projectEffectiveStreak(
  records: readonly LearningDayRecord[],
  evaluatedAt: string,
  settings: LearningTimezoneSettings,
): EffectiveStreakProjection {
  const epochOrder = new Map(settings.epochs.map((epoch, index) => [epoch.timezone_epoch_id, index]));
  const unique = new Map<string, EffectiveDayProjection>();
  for (const record of records) {
    if (!epochOrder.has(record.timezone_epoch_id)) throw new Error(`learning day references unknown timezone epoch: ${record.timezone_epoch_id}`);
    unique.set(record.learning_day_id, {
      learning_day_id: record.learning_day_id,
      timezone_epoch_id: record.timezone_epoch_id,
      local_calendar_date: record.local_calendar_date,
    });
  }
  const effectiveDays = [...unique.values()].sort((left, right) => (
    epochOrder.get(left.timezone_epoch_id)! - epochOrder.get(right.timezone_epoch_id)!
    || left.local_calendar_date.localeCompare(right.local_calendar_date)
  ));
  let best = 0;
  for (const epoch of settings.epochs) {
    const dates = effectiveDays
      .filter((day) => day.timezone_epoch_id === epoch.timezone_epoch_id)
      .map((day) => day.local_calendar_date);
    best = Math.max(best, longestRun(dates));
  }

  const currentDates = effectiveDays
    .filter((day) => day.timezone_epoch_id === settings.timezone_epoch_id)
    .map((day) => day.local_calendar_date);
  const evaluatedDay = localCalendarDate(evaluatedAt, settings.learning_timezone);
  const latestDay = currentDates.at(-1);
  let currentStreak = 0;
  if (latestDay !== undefined && dayNumber(evaluatedDay) - dayNumber(latestDay) <= 1) {
    currentStreak = 1;
    for (let index = currentDates.length - 1; index > 0; index -= 1) {
      if (dayNumber(currentDates[index]!) !== dayNumber(currentDates[index - 1]!) + 1) break;
      currentStreak += 1;
    }
  }
  return {
    policy_version: "0.1.0",
    day_boundary: "LEARNING_TIMEZONE",
    learning_timezone: settings.learning_timezone,
    timezone_epoch_id: settings.timezone_epoch_id,
    effective_days: effectiveDays,
    current_streak: currentStreak,
    best_streak: best,
    total_effective_days: effectiveDays.length,
  };
}
