export const PRODUCT_API_GET_ROUTES = [
  "/api/v1/today",
  "/api/v1/training",
  "/api/v1/progress",
  "/api/v1/history",
  "/api/v1/coach",
  "/api/v1/settings",
] as const;

export const PRODUCT_API_MUTATION_ROUTES = [
  "/api/v1/timezone",
  "/api/v1/packages/import",
  "/api/v1/sessions/start",
  "/api/v1/training/complete",
  "/api/v1/coach/export",
  "/api/v1/coach/import",
] as const;

export type CoachStatus = "NO_PACKAGE" | "TRAINING_READY" | "REVIEW_REQUIRED" | "CONTINUATION_READY";
export type MissionStatus = "OPEN" | "IN_PROGRESS" | "EVIDENCE_PENDING" | "VALIDATION_PENDING" | "CLOSED";

export interface IeltsGoalDto {
  overall_target: number;
  section_minimums: {
    listening?: number;
    reading?: number;
    writing?: number;
    speaking?: number;
  };
}

export interface MissionDto {
  mission_id: string;
  policy_version: "0.1.0";
  run_id: string;
  objective: string;
  target_skills: string[];
  hypothesis_refs: string[];
  status: MissionStatus;
  evidence_refs: string[];
  goal: {
    overall_target: number;
    section_minimums: { listening?: number; reading?: number; writing?: number; speaking?: number };
    unresolved_blockers: string[];
    validated_qualifications: QualificationDto[];
    assessment_evidence_refs: string[];
  };
}

export interface EffectiveStreakDto {
  policy_version: "0.1.0";
  day_boundary: "LEARNING_TIMEZONE";
  learning_timezone: string;
  timezone_epoch_id: string;
  effective_days: Array<{
    learning_day_id: string;
    timezone_epoch_id: string;
    local_calendar_date: string;
  }>;
  current_streak: number;
  best_streak: number;
  total_effective_days: number;
}

export interface ReinforcementEventDto {
  event_type: "PATTERN_BROKEN" | "PERSONAL_BEST" | "RETENTION_CONFIRMED" | "TRANSFER_CONFIRMED" | "MISSION_ADVANCED" | "STREAK_EXTENDED" | "SESSION_COMPLETE";
  evidence_refs: string[];
  policy_version: "0.1.0";
  semantic_id: string;
}

export interface RevealDto {
  policy_version: "0.1.0";
  session_id: string;
  primary_event: ReinforcementEventDto | null;
  supporting_events: ReinforcementEventDto[];
  evidence_refs: string[];
  qualification_change: null | { qualification: string };
  presentation: {
    title: string;
    message: string;
    validation_label: string;
    qualification_label: string | null;
  };
}

export interface TodayDto {
  empty: boolean;
  goal: IeltsGoalDto;
  mission: MissionDto | null;
  effective_streak: EffectiveStreakDto | null;
  last_reveal: RevealDto | null;
  coach_status: CoachStatus;
  primary_action: "GO_TO_COACH" | "CONTINUE_TRAINING";
}

export interface ActivityResourceDto {
  resource_id: string;
  content_format: string;
  content: string;
}

interface ActivityBaseDto {
  activity_id: string;
  prompt: string;
  resources: ActivityResourceDto[];
  accessibility: { keyboard_operable: boolean; screen_reader_label: string };
}

export interface InstructionActivityDto extends ActivityBaseDto {
  type: "INSTRUCTION";
  config: { acknowledge_required: boolean };
}

export interface PresentTextActivityDto extends ActivityBaseDto {
  type: "PRESENT_TEXT";
  config: { display_mode: string };
}

export interface SelectActivityDto extends ActivityBaseDto {
  type: "SELECT";
  config: {
    selection_mode: string;
    options: Array<{ option_id: string; label: string }>;
    min_selections: number;
    max_selections: number;
  };
}

export interface TextResponseActivityDto extends ActivityBaseDto {
  type: "TEXT_RESPONSE";
  config: {
    response_kind: string;
    min_characters: number;
    max_characters: number;
    artifact_type: string;
  };
}

export interface UnsupportedActivityDto extends ActivityBaseDto {
  type: "UNSUPPORTED_RUNTIME_PRIMITIVE";
  primitive_type: string;
  config: Record<never, never>;
}

export type LearnerActivityDto = InstructionActivityDto | PresentTextActivityDto | SelectActivityDto | TextResponseActivityDto | UnsupportedActivityDto;

export interface TrainingDto {
  session_id: string | null;
  package_id: string;
  state: string;
  activity_number: number;
  activity_count: number;
  mission: MissionDto | null;
  current_activity: LearnerActivityDto | null;
  integrity: { status: string };
}

export interface QualificationDto {
  skill_id: string;
  error_pattern_id: string;
  qualification: string;
  evaluated_at?: string;
}

export interface ProgressDto {
  goal: IeltsGoalDto;
  missions: MissionDto[];
  validated_qualifications: QualificationDto[];
  retention: "CONFIRMED" | "EVIDENCE_PENDING";
  transfer: "CONFIRMED" | "EVIDENCE_PENDING";
  pattern_status: "PATTERN_BROKEN" | "NEEDS_REVALIDATION" | "EVIDENCE_PENDING";
}

export interface HistorySubmissionDto {
  activity_id: string;
  response_kind: string;
  option_ids?: string[];
  text?: string;
  evidence_ref: string;
}

export interface HistoryArtifactDto {
  artifact_id: string;
  artifact_type: string;
  created_at: string;
  content_hash: string;
  text: string;
}

export interface HistoryCorrectionDto {
  activity_id?: string;
  initial_outcome?: string;
  revised_outcome?: string;
  evidence_refs?: string[];
}

export interface HistoryItemDto {
  session_id: string;
  state: string;
  objective: string;
  target_skills: string[];
  started_at: string | null;
  completed_at: string | null;
  submissions: HistorySubmissionDto[];
  artifacts: HistoryArtifactDto[];
  corrections: HistoryCorrectionDto[];
  reveal: RevealDto | null;
  integrity: { status: string };
}

export interface HistoryPageDto {
  items: HistoryItemDto[];
  next_cursor: number | null;
}

export interface CoachDto {
  status: CoachStatus;
  session_id?: string;
  checkpoint_id?: string;
  evidence_count?: number;
  evidence_refs?: string[];
  bundle_identity?: string;
}

export interface SettingsDto {
  storage: "LOCAL_RUNTIME_WORKSPACE";
  storage_mode: "LOCAL_ONLY";
  export_available: boolean;
  learning_timezone: null | {
    learning_timezone: string;
    timezone_epoch_id: string;
    effective_from: string;
    created_at: string;
  };
}

export interface TimezoneUpdateRequest {
  operation: "configure" | "change";
  timeZone: string;
}

export interface TimezoneUpdateResponse {
  timezone_epoch_id: string;
  learning_timezone: string;
  effective_from: string;
  created_at: string;
}

export interface PackageImportRequest { package: unknown; protectedEvaluation?: unknown }
export interface PackageImportResponse { status: "IMPORTED" | "IDEMPOTENT"; packageId: string; canonicalHash: string }
export interface StartSessionRequest { packageId?: string; sessionId?: string }
export type StartSessionResponse = TrainingDto;
export type ActivityResponseDto = { optionIds: string[] } | { text: string };
export interface SubmitActivityRequest { sessionId: string; response?: ActivityResponseDto }
export interface SubmitActivityResponse {
  state: string;
  submission: { activity_id: string; outcome?: string; evidence_refs?: string[] };
  artifacts: Array<{ artifact_id: string; artifact_type: string; content_hash: string; created_at: string }>;
  training: TrainingDto;
  reinforcement?: { claims_mastery: boolean };
  reveal?: RevealDto;
  coach?: CoachDto;
}

export interface CoachExportRequest { sessionId: string }
export interface PortableCoachRecordDto {
  record_id: string;
  record_kind: "training_package" | "raw_event_stream" | "learner_artifact";
  protocol_version: string;
  producer: string;
  trust_classification: "data";
  content_hash: string;
  media_type: string;
  content: string;
}
export interface CoachExportResponse {
  schema_version: "0.1.0";
  api_version: "v1";
  bundle_type: "band8_coach_download";
  trust_classification: "DATA_ONLY";
  checkpoint_id: string;
  coach_bundle: {
    bundle_type: "band8_coach_input";
    checkpoint_id: string;
    protocol_version: string;
    schema_version: string;
    trust_classification: "DATA_ONLY";
    trust_contract: string;
    relevant_activity_refs: string[];
    contract_versions: { [name: string]: string };
  };
  checkpoint_manifest: {
    checkpoint_id: string;
    checkpoint_reason: string;
    created_at: string;
    package_hash: string;
    package_id: string;
    protocol_version: string;
    required_evidence_refs: string[];
    run_id: string;
    schema_version: string;
    segment_id: string;
    session_id: string;
    status: string;
  };
  records: PortableCoachRecordDto[];
}

export interface ContinuationImportRequest { priorSessionId: string; package: unknown }
export interface ContinuationImportResponse {
  status: "ATTACHED" | "IDEMPOTENT";
  sessionId: string;
  packageId: string;
  coach: CoachDto;
}

export interface ProductApiGetMap {
  "/api/v1/today": TodayDto;
  "/api/v1/training": TrainingDto | null;
  "/api/v1/progress": ProgressDto;
  "/api/v1/history": HistoryPageDto;
  "/api/v1/coach": CoachDto;
  "/api/v1/settings": SettingsDto;
}

export interface ProductApiMutationMap {
  "/api/v1/timezone": { request: TimezoneUpdateRequest; response: TimezoneUpdateResponse };
  "/api/v1/packages/import": { request: PackageImportRequest; response: PackageImportResponse };
  "/api/v1/sessions/start": { request: StartSessionRequest; response: StartSessionResponse };
  "/api/v1/training/complete": { request: SubmitActivityRequest; response: SubmitActivityResponse };
  "/api/v1/coach/export": { request: CoachExportRequest; response: CoachExportResponse };
  "/api/v1/coach/import": { request: ContinuationImportRequest; response: ContinuationImportResponse };
}
