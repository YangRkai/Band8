import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { canonicalJson, parseJsonStrict } from "../protocol/canonical.js";
import { epochMilliseconds } from "../reinforcement/time.js";
import { writeTextAtomic } from "./atomic.js";
import type { RuntimeWorkspace } from "./workspace.js";
import { storageKey } from "./workspace.js";

const epochIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/u;
const localDatePattern = /^\d{4}-\d{2}-\d{2}$/u;

export interface LearningTimezoneEpoch {
  timezone_epoch_id: string;
  learning_timezone: string;
  effective_from: string;
  created_at: string;
}

export interface LearningTimezoneSettings {
  version: 1;
  learning_timezone: string;
  timezone_epoch_id: string;
  epochs: LearningTimezoneEpoch[];
}

export interface LearningDayRecord {
  version: 1;
  session_id: string;
  completed_at: string;
  timezone_epoch_id: string;
  learning_timezone: string;
  local_calendar_date: string;
  learning_day_id: string;
  created_at: string;
}

export interface AssignLearningDayInput {
  sessionId: string;
  completedAt: string;
}

export function validateLearningTimezone(value: string): string {
  if (
    value.trim() !== value
    || value.length === 0
    || /^[+-]\d{2}(?::?\d{2})?$/u.test(value)
    || /^UTC[+-]/iu.test(value)
    || /^Etc\/GMT[+-]/iu.test(value)
  ) throw new Error(`invalid IANA learning timezone: ${value}`);
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: value });
    return formatter.resolvedOptions().timeZone;
  } catch {
    throw new Error(`invalid IANA learning timezone: ${value}`);
  }
}

export function localCalendarDate(timestamp: string, timeZone: string): string {
  const date = new Date(epochMilliseconds(timestamp));
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    calendar: "iso8601",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): string => {
    const value = parts.find((candidate) => candidate.type === type)?.value;
    if (value === undefined) throw new Error(`cannot resolve ${type} in learning timezone`);
    return value;
  };
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function validateEpoch(epoch: LearningTimezoneEpoch): void {
  if (
    Object.keys(epoch).length !== 4
    || !epochIdPattern.test(epoch.timezone_epoch_id)
    || validateLearningTimezone(epoch.learning_timezone) !== epoch.learning_timezone
    || !Number.isFinite(Date.parse(epoch.effective_from))
    || !Number.isFinite(Date.parse(epoch.created_at))
    || epoch.effective_from !== epoch.created_at
  ) throw new Error("invalid learning timezone epoch");
}

function validateSettings(settings: LearningTimezoneSettings): void {
  if (
    Object.keys(settings).some((key) => !["version", "learning_timezone", "timezone_epoch_id", "epochs"].includes(key))
    || settings.version !== 1
    || !Array.isArray(settings.epochs)
    || settings.epochs.length === 0
  ) throw new Error("invalid learning timezone settings");
  for (const epoch of settings.epochs) validateEpoch(epoch);
  for (let index = 1; index < settings.epochs.length; index += 1) {
    if (epochMilliseconds(settings.epochs[index]!.effective_from) <= epochMilliseconds(settings.epochs[index - 1]!.effective_from)) {
      throw new Error("learning timezone epochs are not strictly ordered");
    }
  }
  const current = settings.epochs.at(-1)!;
  if (
    settings.learning_timezone !== current.learning_timezone
    || settings.timezone_epoch_id !== current.timezone_epoch_id
    || new Set(settings.epochs.map((epoch) => epoch.timezone_epoch_id)).size !== settings.epochs.length
  ) throw new Error("invalid current learning timezone epoch");
}

function validateLearningDay(record: LearningDayRecord): void {
  if (
    Object.keys(record).some((key) => ![
      "version", "session_id", "completed_at", "timezone_epoch_id", "learning_timezone",
      "local_calendar_date", "learning_day_id", "created_at",
    ].includes(key))
    || record.version !== 1
    || typeof record.session_id !== "string"
    || record.session_id.length === 0
    || !Number.isFinite(Date.parse(record.completed_at))
    || !epochIdPattern.test(record.timezone_epoch_id)
    || validateLearningTimezone(record.learning_timezone) !== record.learning_timezone
    || !localDatePattern.test(record.local_calendar_date)
    || record.learning_day_id !== `${record.timezone_epoch_id}:${record.local_calendar_date}`
    || !Number.isFinite(Date.parse(record.created_at))
  ) throw new Error("invalid learning-day record");
}

export class LearningTimezoneStore {
  readonly #settingsPath: string;

  constructor(
    private readonly workspace: RuntimeWorkspace,
    private readonly now: () => string,
    private readonly epochIdFactory: () => string,
  ) {
    this.#settingsPath = join(workspace.paths.settings, "learning-timezone.json");
  }

  read(): LearningTimezoneSettings | undefined {
    if (!existsSync(this.#settingsPath)) return undefined;
    const settings = parseJsonStrict(readFileSync(this.#settingsPath, "utf8")) as LearningTimezoneSettings;
    validateSettings(settings);
    return settings;
  }

  configure(timeZone: string): LearningTimezoneEpoch {
    if (this.read() !== undefined) throw new Error("learning timezone is already configured");
    const epoch = this.#newEpoch(timeZone);
    this.#writeSettings({
      version: 1,
      learning_timezone: epoch.learning_timezone,
      timezone_epoch_id: epoch.timezone_epoch_id,
      epochs: [epoch],
    });
    return epoch;
  }

  change(timeZone: string): LearningTimezoneEpoch {
    const settings = this.read();
    if (settings === undefined) throw new Error("learning timezone is not configured");
    const canonical = validateLearningTimezone(timeZone);
    if (canonical === settings.learning_timezone) throw new Error("learning timezone is already active");
    const epoch = this.#newEpoch(canonical);
    if (epochMilliseconds(epoch.effective_from) <= epochMilliseconds(settings.epochs.at(-1)!.effective_from)) {
      throw new Error("learning timezone change time must advance");
    }
    this.#writeSettings({
      version: 1,
      learning_timezone: epoch.learning_timezone,
      timezone_epoch_id: epoch.timezone_epoch_id,
      epochs: [...settings.epochs, epoch],
    });
    return epoch;
  }

  epochFor(timestamp: string): LearningTimezoneEpoch {
    const settings = this.read();
    if (settings === undefined) throw new Error("learning timezone is not configured");
    const instant = epochMilliseconds(timestamp);
    const epoch = settings.epochs.filter((candidate) => epochMilliseconds(candidate.effective_from) <= instant).at(-1);
    if (epoch === undefined) throw new Error("no learning timezone epoch applies to timestamp");
    return epoch;
  }

  assignLearningDay(input: AssignLearningDayInput): LearningDayRecord {
    const path = this.#learningDayPath(input.sessionId);
    if (existsSync(path)) {
      const existing = parseJsonStrict(readFileSync(path, "utf8")) as LearningDayRecord;
      validateLearningDay(existing);
      if (existing.session_id !== input.sessionId || existing.completed_at !== input.completedAt) {
        throw new Error("learning-day identity collision");
      }
      return existing;
    }
    const epoch = this.epochFor(input.completedAt);
    const localDate = localCalendarDate(input.completedAt, epoch.learning_timezone);
    const record: LearningDayRecord = {
      version: 1,
      session_id: input.sessionId,
      completed_at: input.completedAt,
      timezone_epoch_id: epoch.timezone_epoch_id,
      learning_timezone: epoch.learning_timezone,
      local_calendar_date: localDate,
      learning_day_id: `${epoch.timezone_epoch_id}:${localDate}`,
      created_at: this.now(),
    };
    validateLearningDay(record);
    writeTextAtomic(path, `${canonicalJson(record)}\n`);
    return record;
  }

  listLearningDays(): LearningDayRecord[] {
    return readdirSync(this.workspace.paths.reinforcementLearningDays, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => {
        const record = parseJsonStrict(readFileSync(join(this.workspace.paths.reinforcementLearningDays, entry.name), "utf8")) as LearningDayRecord;
        validateLearningDay(record);
        if (entry.name !== `${storageKey(record.session_id)}.json`) throw new Error("learning-day path identity mismatch");
        return record;
      })
      .sort((left, right) => epochMilliseconds(left.completed_at) - epochMilliseconds(right.completed_at) || left.session_id.localeCompare(right.session_id));
  }

  #newEpoch(timeZone: string): LearningTimezoneEpoch {
    const createdAt = this.now();
    const epoch: LearningTimezoneEpoch = {
      timezone_epoch_id: this.epochIdFactory(),
      learning_timezone: validateLearningTimezone(timeZone),
      effective_from: createdAt,
      created_at: createdAt,
    };
    validateEpoch(epoch);
    return epoch;
  }

  #writeSettings(settings: LearningTimezoneSettings): void {
    validateSettings(settings);
    writeTextAtomic(this.#settingsPath, `${canonicalJson(settings)}\n`);
  }

  #learningDayPath(sessionId: string): string {
    if (sessionId.length === 0) throw new Error("session ID is required for learning day");
    return join(this.workspace.paths.reinforcementLearningDays, `${storageKey(sessionId)}.json`);
  }
}
