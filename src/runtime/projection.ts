type Document = Record<string, any>;

export interface LearnerActivityView {
  activity_id: string;
  type: "INSTRUCTION" | "PRESENT_TEXT" | "SELECT" | string;
  prompt: string;
  config: Document;
  resources: Array<{ resource_id: string; content_format: string; content: string }>;
  accessibility: Document;
}

export function projectLearnerActivity(packageDocument: Document, activity: Document): LearnerActivityView {
  const resourcesById = new Map<string, Document>(
    packageDocument.resources.map((resource: Document) => [resource.resource_id, resource]),
  );
  const safeConfig: Document = activity.type === "SELECT"
    ? {
        selection_mode: activity.config.selection_mode,
        options: activity.config.options.map((option: Document) => ({ option_id: option.option_id, label: option.label })),
        min_selections: activity.config.min_selections,
        max_selections: activity.config.max_selections,
      }
    : activity.type === "INSTRUCTION"
      ? { acknowledge_required: activity.config.acknowledge_required }
      : activity.type === "PRESENT_TEXT"
        ? { display_mode: activity.config.display_mode }
        : {};
  return {
    activity_id: activity.activity_id,
    type: activity.type,
    prompt: activity.prompt,
    config: safeConfig,
    resources: activity.resource_refs.map((id: string) => {
      const resource = resourcesById.get(id);
      if (resource === undefined) throw new Error(`resource does not resolve: ${id}`);
      return {
        resource_id: resource.resource_id,
        content_format: resource.content_format,
        content: resource.content,
      };
    }),
    accessibility: {
      keyboard_operable: activity.accessibility.keyboard_operable,
      screen_reader_label: activity.accessibility.screen_reader_label,
    },
  };
}
