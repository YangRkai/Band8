import type { AuthoritativeSessionEvidence } from "../../../src/reinforcement/types.js";
import type {
  LearningDayRecord,
  LearningTimezoneSettings,
} from "../../../src/storage/learning-timezone-store.js";

export function testLearningCalendar(sessions: readonly AuthoritativeSessionEvidence[]): {
  learningDays: LearningDayRecord[];
  learningTimezone: LearningTimezoneSettings;
} {
  const epoch = {
    timezone_epoch_id: "timezone-epoch-test-utc",
    learning_timezone: "UTC",
    effective_from: "2020-01-01T00:00:00.000Z",
    created_at: "2020-01-01T00:00:00.000Z",
  };
  return {
    learningTimezone: {
      version: 1,
      learning_timezone: epoch.learning_timezone,
      timezone_epoch_id: epoch.timezone_epoch_id,
      epochs: [epoch],
    },
    learningDays: sessions
      .filter((session) => session.hasLegitimateParticipation && !session.clockAnomaly)
      .map((session) => {
        const localDate = new Date(session.completedAt).toISOString().slice(0, 10);
        return {
          version: 1,
          session_id: session.sessionId,
          completed_at: session.completedAt,
          timezone_epoch_id: epoch.timezone_epoch_id,
          learning_timezone: epoch.learning_timezone,
          local_calendar_date: localDate,
          learning_day_id: `${epoch.timezone_epoch_id}:${localDate}`,
          created_at: session.completedAt,
        };
      }),
  };
}
