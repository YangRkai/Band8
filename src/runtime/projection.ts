import type { LearnerActivityDto } from "../product-api/dto.js";

type JsonObject = { [key: string]: unknown };

function object(value: unknown, name: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as JsonObject;
}

function string(value: unknown, name: string): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  return value;
}

function number(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${name} must be a finite number`);
  return value;
}

function boolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${name} must be a boolean`);
  return value;
}

function array(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value;
}

export type LearnerActivityView = LearnerActivityDto;

export function projectLearnerActivity(packageDocumentValue: unknown, activityValue: unknown): LearnerActivityDto {
  const packageDocument = object(packageDocumentValue, "package");
  const activity = object(activityValue, "activity");
  const config = object(activity.config, "activity config");
  const accessibility = object(activity.accessibility, "activity accessibility");
  const resourcesById = new Map<string, JsonObject>(
    array(packageDocument.resources, "package resources").map((value) => {
      const resource = object(value, "resource");
      return [string(resource.resource_id, "resource_id"), resource];
    }),
  );
  const base = {
    activity_id: string(activity.activity_id, "activity_id"),
    prompt: string(activity.prompt, "activity prompt"),
    resources: array(activity.resource_refs, "activity resource_refs").map((value) => {
      const id = string(value, "resource_ref");
      const resource = resourcesById.get(id);
      if (resource === undefined) throw new Error(`resource does not resolve: ${id}`);
      return {
        resource_id: string(resource.resource_id, "resource_id"),
        content_format: string(resource.content_format, "resource content_format"),
        content: string(resource.content, "resource content"),
      };
    }),
    accessibility: {
      keyboard_operable: boolean(accessibility.keyboard_operable, "keyboard_operable"),
      screen_reader_label: string(accessibility.screen_reader_label, "screen_reader_label"),
    },
  };
  const type = string(activity.type, "activity type");
  if (type === "INSTRUCTION") {
    return { ...base, type, config: { acknowledge_required: boolean(config.acknowledge_required, "acknowledge_required") } };
  }
  if (type === "PRESENT_TEXT") {
    return { ...base, type, config: { display_mode: string(config.display_mode, "display_mode") } };
  }
  if (type === "SELECT") {
    return {
      ...base,
      type,
      config: {
        selection_mode: string(config.selection_mode, "selection_mode"),
        options: array(config.options, "SELECT options").map((value) => {
          const option = object(value, "SELECT option");
          return { option_id: string(option.option_id, "option_id"), label: string(option.label, "option label") };
        }),
        min_selections: number(config.min_selections, "min_selections"),
        max_selections: number(config.max_selections, "max_selections"),
      },
    };
  }
  if (type === "TEXT_RESPONSE") {
    return {
      ...base,
      type,
      config: {
        response_kind: string(config.response_kind, "response_kind"),
        min_characters: number(config.min_characters, "min_characters"),
        max_characters: number(config.max_characters, "max_characters"),
        artifact_type: string(config.artifact_type, "artifact_type"),
      },
    };
  }
  return { ...base, type: "UNSUPPORTED_RUNTIME_PRIMITIVE", primitive_type: type, config: {} };
}
