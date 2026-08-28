import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  ActivityResponseDto,
  CoachDto,
  ContinuationImportResponse,
  HistoryPageDto,
  IeltsGoalDto,
  LearnerActivityDto,
  ProgressDto,
  RevealDto,
  SettingsDto,
  SubmitActivityResponse,
  TodayDto,
  TrainingDto,
} from "../../src/product-api/dto.js";
import { ApiError, getJson, postJson, postResponse } from "./api.js";

type Route = "today" | "train" | "progress" | "history" | "coach" | "settings";
type PageState =
  | { route: "today"; value: TodayDto }
  | { route: "train"; value: TrainingDto | null }
  | { route: "progress"; value: ProgressDto }
  | { route: "history"; value: HistoryPageDto }
  | { route: "coach"; value: CoachDto }
  | { route: "settings"; value: SettingsDto };

const primaryRoutes: Array<{ id: Exclude<Route, "settings">; label: string }> = [
  { id: "today", label: "TODAY" },
  { id: "train", label: "TRAIN" },
  { id: "progress", label: "PROGRESS" },
  { id: "history", label: "HISTORY" },
  { id: "coach", label: "COACH" },
];

function routeFromHash(): Route {
  const value = window.location.hash.replace(/^#/u, "");
  return ["today", "train", "progress", "history", "coach", "settings"].includes(value) ? value as Route : "today";
}

function statusLabel(value: string): string {
  return value.replaceAll("_", " ");
}

function parseFileJson(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("JSON object required");
    return value;
  } catch {
    throw new ApiError("INVALID_JSON_FILE", "The selected file must contain one valid JSON object.");
  }
}

async function loadPage(route: Route): Promise<PageState> {
  switch (route) {
    case "today": return { route, value: await getJson("/api/v1/today") };
    case "train": return { route, value: await getJson("/api/v1/training") };
    case "progress": return { route, value: await getJson("/api/v1/progress") };
    case "history": return { route, value: await getJson("/api/v1/history?limit=20") };
    case "coach": return { route, value: await getJson("/api/v1/coach") };
    case "settings": return { route, value: await getJson("/api/v1/settings") };
  }
}

export function mergeHistoryPages(current: HistoryPageDto, next: HistoryPageDto): HistoryPageDto {
  const items = [...current.items];
  const seen = new Set(items.map((item) => item.session_id));
  for (const item of next.items) {
    if (seen.has(item.session_id)) continue;
    seen.add(item.session_id);
    items.push(item);
  }
  return { items, next_cursor: next.next_cursor };
}

export function Navigation({ current }: { current: Route }): React.JSX.Element {
  return <nav className="primary-nav" aria-label="Primary">
    {primaryRoutes.map((route) => <a key={route.id} href={`#${route.id}`} aria-current={current === route.id ? "page" : undefined}>{route.label}</a>)}
  </nav>;
}

function Goal({ value }: { value: IeltsGoalDto }): React.JSX.Element {
  const sections = [
    ["Listening", value.section_minimums.listening],
    ["Reading", value.section_minimums.reading],
    ["Writing", value.section_minimums.writing],
    ["Speaking", value.section_minimums.speaking],
  ] as const;
  return <section className="goal" aria-labelledby="goal-title">
    <p className="eyebrow" id="goal-title">IELTS TARGET</p>
    <strong>Overall ≥ {value.overall_target.toFixed(1)}</strong>
    {sections.filter(([, target]) => typeof target === "number" && Number.isFinite(target)).map(([label, target]) => <span key={label}>{label} ≥ {target!.toFixed(1)}</span>)}
  </section>;
}

export function TodayView({ value, onNavigate }: { value: TodayDto; onNavigate: (route: Route) => void }): React.JSX.Element {
  return <main id="main" className="page today-page">
    <header className="hero"><p className="brand-mark">B8</p><div><h1>Band8</h1><p>Precision IELTS training</p></div></header>
    <Goal value={value.goal} />
    {value.empty
      ? <section className="mission-card empty-state"><p className="eyebrow">CURRENT MISSION</p><h2>No training package yet.</h2><p>Generate your first Band8 Coach package<br />and import it here.</p><button className="primary" onClick={() => onNavigate("coach")}>GO TO COACH</button></section>
      : <section className="mission-card" aria-live="polite"><p className="eyebrow">CURRENT MISSION</p><h2>{value.mission?.objective}</h2><p>{value.mission?.target_skills.join(" · ")}</p><strong className="status-chip">{statusLabel(value.mission?.status ?? "EVIDENCE_PENDING")}</strong><button className="primary" onClick={() => onNavigate("train")}>CONTINUE TRAINING</button></section>}
    <aside className="signal-row" aria-label="Current learning signals">
      <span>{value.effective_streak === null ? "Streak calendar not configured" : `${value.effective_streak.total_effective_days} effective training days`}</span>
      <span>{value.last_reveal?.primary_event === null || value.last_reveal === null ? "No reveal yet" : value.last_reveal.presentation.title}</span>
      <span>Coach: {statusLabel(value.coach_status)}</span>
    </aside>
  </main>;
}

export function RevealView({ value }: { value: RevealDto }): React.JSX.Element {
  return <section className="reveal" aria-live="polite">
    <p className="eyebrow">SESSION REVEAL</p><h2>{value.presentation.title}</h2><p>{value.presentation.message}</p>
    <strong>{value.presentation.validation_label}</strong>
    {value.supporting_events.length > 0 && <div><p className="eyebrow">SUPPORTING EVENTS</p><ul>{value.supporting_events.map((supporting) => <li key={supporting.semantic_id}>{statusLabel(supporting.event_type)}</li>)}</ul></div>}
    {value.presentation.qualification_label && <p>{value.presentation.qualification_label}</p>}
    <details><summary>Evidence</summary><p>{value.evidence_refs.join(" · ")}</p></details>
  </section>;
}

export function TrainingActivityView({ activity, busy, onSubmit }: {
  activity: LearnerActivityDto;
  busy: boolean;
  onSubmit: (response?: ActivityResponseDto) => Promise<void>;
}): React.JSX.Element {
  const [selection, setSelection] = useState<string[]>([]);
  const [text, setText] = useState("");
  const words = text.trim().length === 0 ? 0 : text.trim().split(/\s+/u).length;
  if (activity.type === "UNSUPPORTED_RUNTIME_PRIMITIVE") {
    return <section className="activity error-panel" role="alert"><h2>UNSUPPORTED_RUNTIME_PRIMITIVE</h2><p>{activity.primitive_type}</p><p>{activity.prompt}</p></section>;
  }
  return <section className="activity" aria-labelledby="activity-prompt">
    <p className="eyebrow">CURRENT ACTIVITY</p><h2 id="activity-prompt">{activity.prompt}</h2>
    {activity.resources.map((resource) => <div className="resource-text" key={resource.resource_id}>{resource.content}</div>)}
    {activity.type === "SELECT" && <fieldset><legend>{activity.accessibility.screen_reader_label}</legend>
      {activity.config.options.map((option) => <label className="option" key={option.option_id}><input
        type={activity.config.max_selections === 1 ? "radio" : "checkbox"}
        name={activity.activity_id}
        value={option.option_id}
        checked={selection.includes(option.option_id)}
        disabled={activity.config.max_selections > 1 && !selection.includes(option.option_id) && selection.length >= activity.config.max_selections}
        onChange={() => setSelection(activity.config.max_selections === 1 ? [option.option_id] : selection.includes(option.option_id) ? selection.filter((item) => item !== option.option_id) : selection.length < activity.config.max_selections ? [...selection, option.option_id] : selection)}
      /><span>{option.label}</span></label>)}</fieldset>}
    {activity.type === "TEXT_RESPONSE" && <div className="writing-field"><label htmlFor={`response-${activity.activity_id}`}>Your response</label><textarea
      id={`response-${activity.activity_id}`}
      value={text}
      minLength={activity.config.min_characters}
      maxLength={activity.config.max_characters}
      onChange={(event) => setText(event.target.value)}
      aria-describedby={`count-${activity.activity_id}`}
    /><p id={`count-${activity.activity_id}`}>Word count: {words}</p></div>}
    <button className="primary" disabled={busy || (activity.type === "SELECT" && (selection.length < activity.config.min_selections || selection.length > activity.config.max_selections)) || (activity.type === "TEXT_RESPONSE" && text.length < activity.config.min_characters)} onClick={() => void onSubmit(
      activity.type === "SELECT" ? { optionIds: selection } : activity.type === "TEXT_RESPONSE" ? { text } : undefined,
    )}>{busy ? "SUBMITTING" : activity.type === "SELECT" || activity.type === "TEXT_RESPONSE" ? "SUBMIT" : "Continue"}</button>
  </section>;
}

export function TrainingIdleView({ value, onStart, onNavigate }: {
  value: TrainingDto | null;
  onStart: () => void;
  onNavigate: (route: Route) => void;
}): React.JSX.Element {
  if (value?.state === "QUARANTINED") return <section className="empty-state error-panel" role="alert"><h1>Evidence integrity issue detected.</h1><p>This session has been isolated and will not contribute to progress.</p></section>;
  if (value?.state === "AWAITING_COACH") return <section className="empty-state"><h1>COACH REVIEW REQUIRED</h1><button className="primary" onClick={() => onNavigate("coach")}>GO TO COACH</button></section>;
  if (value?.state === "COMPLETED") return <section className="empty-state"><h1>SESSION COMPLETED</h1><button className="primary" onClick={() => onNavigate("today")}>RETURN TO TODAY</button></section>;
  return <section className="empty-state"><h1>Training ready</h1><button className="primary" onClick={onStart}>START TRAINING</button></section>;
}

export function CoachView({ value, busy, onExport, onImport, onImportTraining }: {
  value: CoachDto;
  busy: boolean;
  onExport: () => Promise<void>;
  onImport: (file: File) => Promise<void>;
  onImportTraining: (packageFile: File, protectedFile?: File) => Promise<void>;
}): React.JSX.Element {
  const [protectedFile, setProtectedFile] = useState<File>();
  return <main id="main" className="page"><p className="eyebrow">COACH STATUS</p><h1>{statusLabel(value.status)}</h1>
    {value.checkpoint_id && <section className="detail-card"><p>Current checkpoint</p><strong>{value.checkpoint_id}</strong><p>Evidence count: {value.evidence_count}</p><p>Bundle identity: {value.bundle_identity}</p></section>}
    <div className="action-stack">
      <button className="primary" disabled={busy || value.status !== "REVIEW_REQUIRED"} onClick={() => void onExport()}>EXPORT COACH BUNDLE</button>
      <label className="file-action">IMPORT CONTINUATION<input type="file" accept="application/json,.json" disabled={busy || value.status !== "REVIEW_REQUIRED"} onChange={(event) => { const file = event.target.files?.[0]; if (file) void onImport(file); }} /></label>
    </div>
    <section className="import-card"><h2>Import Training Package</h2><label>Protected evaluation, if required<input type="file" accept="application/json,.json" onChange={(event) => setProtectedFile(event.target.files?.[0])} /></label><label className="file-action">IMPORT TRAINING PACKAGE<input type="file" accept="application/json,.json" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void onImportTraining(file, protectedFile); }} /></label></section>
  </main>;
}

export function ProgressView({ value }: { value: ProgressDto }): React.JSX.Element {
  return <main id="main" className="page"><Goal value={value.goal} /><h1>Progress</h1><section className="list-grid"><article><p className="eyebrow">CURRENT MISSIONS</p>{value.missions.map((mission) => <div key={mission.mission_id}><strong>{mission.target_skills.join(" · ")}</strong><p>{statusLabel(mission.status)}</p></div>)}</article><article><p className="eyebrow">VALIDATED QUALIFICATIONS</p>{value.validated_qualifications.length === 0 ? <strong>EVIDENCE PENDING</strong> : value.validated_qualifications.map((qualification) => <div key={`${qualification.skill_id}:${qualification.error_pattern_id}`}><strong>{qualification.skill_id}</strong><p>{qualification.error_pattern_id} · {statusLabel(qualification.qualification)}</p></div>)}</article><article><p className="eyebrow">RETENTION</p><strong>{statusLabel(value.retention)}</strong></article><article><p className="eyebrow">TRANSFER</p><strong>{statusLabel(value.transfer)}</strong></article><article><p className="eyebrow">PATTERN STATUS</p><strong>{statusLabel(value.pattern_status)}</strong></article></section></main>;
}

export function HistoryView({ value, busy, onLoadMore }: { value: HistoryPageDto; busy: boolean; onLoadMore: () => Promise<void> }): React.JSX.Element {
  return <main id="main" className="page"><h1>History</h1>{value.items.length === 0 ? <p>No sessions yet.</p> : value.items.map((item) => <article className="history-item" data-session-id={item.session_id} key={item.session_id}><p className="eyebrow">{statusLabel(item.state)}</p><h2>{item.objective}</h2><p>{item.target_skills.join(" · ")}</p>{item.artifacts.map((artifact) => <blockquote key={artifact.artifact_id}>{artifact.text}</blockquote>)}{item.reveal && <><p>Reveal: {item.reveal.presentation.title}</p>{item.reveal.presentation.qualification_label && <p>{item.reveal.presentation.qualification_label}</p>}</>}</article>)}{value.next_cursor !== null && <button className="primary" disabled={busy} onClick={() => void onLoadMore()}>{busy ? "LOADING" : "LOAD MORE"}</button>}</main>;
}

function SettingsView({ value, busy, onChange }: { value: SettingsDto; busy: boolean; onChange: (zone: string) => Promise<void> }): React.JSX.Element {
  const [zone, setZone] = useState(value.learning_timezone?.learning_timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  return <main id="main" className="page"><h1>Settings</h1><section className="detail-card"><label htmlFor="timezone">Learning timezone</label><input id="timezone" value={zone} onChange={(event) => setZone(event.target.value)} aria-describedby="timezone-warning" /><p id="timezone-warning">Changing your learning timezone starts a new streak calendar epoch. Historical training and achievements will not be deleted.</p><button className="primary" disabled={busy} onClick={() => void onChange(zone)}>SAVE TIMEZONE</button></section><section className="detail-card"><h2>Workspace information</h2><p>{value.storage === "LOCAL_RUNTIME_WORKSPACE" ? "Band8 local Runtime workspace" : "Local storage"}</p><p>{value.storage_mode === "LOCAL_ONLY" ? "Local server · local data only" : "Storage status unavailable"}</p><p>{value.export_available ? "Data export available" : "Data export unavailable"}</p></section></main>;
}

function ErrorMessage({ error }: { error: string | null }): React.JSX.Element | null {
  return error === null ? null : <div className="global-error" role="alert">{error}</div>;
}

export function App(): React.JSX.Element {
  const [route, setRoute] = useState<Route>(() => routeFromHash());
  const [page, setPage] = useState<PageState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [settings, setSettings] = useState<SettingsDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState<RevealDto | null>(null);
  const loadSequence = useRef(0);
  const historyRequestSequence = useRef(0);
  const mutationSequence = useRef(0);
  const navigationSequence = useRef(0);
  const routeRef = useRef(route);
  const navigate = useCallback((next: Route) => {
    navigationSequence.current += 1;
    routeRef.current = next;
    setBusy(false);
    setLoaded(false);
    window.location.hash = next;
    setRoute(next);
  }, []);
  const load = useCallback(async (targetRoute: Route) => {
    const sequence = ++loadSequence.current;
    historyRequestSequence.current += 1;
    setLoaded(false);
    setError(null);
    try {
      const [settingsValue, routePage] = await Promise.all([getJson("/api/v1/settings"), loadPage(targetRoute)]);
      if (sequence !== loadSequence.current || routeRef.current !== targetRoute) return;
      setSettings(settingsValue);
      setPage(routePage);
    } catch (caught) {
      if (sequence !== loadSequence.current || routeRef.current !== targetRoute) return;
      setError(caught instanceof ApiError ? `${caught.code}: ${caught.message}` : String(caught));
    } finally {
      if (sequence === loadSequence.current && routeRef.current === targetRoute) setLoaded(true);
    }
  }, []);
  useEffect(() => { const listener = () => { const next = routeFromHash(); navigationSequence.current += 1; routeRef.current = next; historyRequestSequence.current += 1; setBusy(false); setLoaded(false); setRoute(next); }; window.addEventListener("hashchange", listener); return () => window.removeEventListener("hashchange", listener); }, []);
  useEffect(() => { if (route !== "train") setReveal(null); }, [route]);
  useEffect(() => { void load(route); }, [load, route]);
  const mutate = useCallback(async <Result,>(operation: () => Promise<Result>): Promise<Result | undefined> => {
    const targetRoute = routeRef.current;
    const targetNavigation = navigationSequence.current;
    const sequence = ++mutationSequence.current;
    setBusy(true);
    setError(null);
    try {
      const result = await operation();
      await load(routeRef.current);
      return sequence === mutationSequence.current
        && routeRef.current === targetRoute
        && navigationSequence.current === targetNavigation
        ? result
        : undefined;
    } catch (caught) {
      if (
        sequence === mutationSequence.current
        && routeRef.current === targetRoute
        && navigationSequence.current === targetNavigation
      ) setError(caught instanceof ApiError ? `${caught.code}: ${caught.message}` : String(caught));
      return undefined;
    } finally {
      if (sequence === mutationSequence.current) setBusy(false);
    }
  }, [load]);
  const loadMoreHistory = useCallback(async () => {
    if (routeRef.current !== "history" || page?.route !== "history" || page.value.next_cursor === null) return;
    const cursor = page.value.next_cursor;
    const sequence = ++historyRequestSequence.current;
    setBusy(true);
    setError(null);
    try {
      const next = await getJson(`/api/v1/history?limit=20&cursor=${encodeURIComponent(String(cursor))}`);
      if (sequence !== historyRequestSequence.current || routeRef.current !== "history") return;
      setPage((current) => current?.route !== "history" || current.value.next_cursor !== cursor ? current : {
        route: "history",
        value: mergeHistoryPages(current.value, next),
      });
    } catch (caught) {
      if (sequence === historyRequestSequence.current && routeRef.current === "history") setError(caught instanceof ApiError ? `${caught.code}: ${caught.message}` : String(caught));
    } finally {
      if (sequence === historyRequestSequence.current) setBusy(false);
    }
  }, [page]);
  const timezoneMissing = settings?.learning_timezone === null;
  const detectedZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  let content: React.JSX.Element;
  if (timezoneMissing && route !== "settings") {
    content = <main id="main" className="page onboarding"><p className="eyebrow">FIRST RUN</p><h1>Confirm your learning timezone</h1><p>Your browser suggests <strong>{detectedZone}</strong>. Runtime will validate and own the final setting.</p><button className="primary" disabled={busy} onClick={() => void mutate(() => postJson("/api/v1/timezone", { operation: "configure", timeZone: detectedZone }))}>USE {detectedZone}</button></main>;
  } else if (!loaded || page === null || page.route !== route) {
    content = <main id="main" className="page"><p>Loading Band8…</p></main>;
  } else if (page.route === "train") {
    const training = page.value;
    content = <main id="main" className="page training-page">{reveal
      ? <RevealView value={reveal} />
      : training?.current_activity
        ? <><header className="training-context"><p>{training.mission?.objective}</p><span>Activity {training.activity_number} of {training.activity_count}</span></header><TrainingActivityView activity={training.current_activity} busy={busy} onSubmit={async (response) => {
            const request = response === undefined ? { sessionId: training.session_id! } : { sessionId: training.session_id!, response };
            const result = await mutate<SubmitActivityResponse>(() => postJson("/api/v1/training/complete", request));
            if (result?.reveal) setReveal(result.reveal);
          }} /></>
        : <TrainingIdleView value={training} onNavigate={navigate} onStart={() => void mutate(() => postJson("/api/v1/sessions/start", training?.session_id ? { sessionId: training.session_id } : training?.package_id ? { packageId: training.package_id } : {}))} />}</main>;
  } else if (page.route === "today") {
    content = <TodayView value={page.value} onNavigate={navigate} />;
  } else if (page.route === "progress") {
    content = <ProgressView value={page.value} />;
  } else if (page.route === "history") {
    content = <HistoryView value={page.value} busy={busy} onLoadMore={loadMoreHistory} />;
  } else if (page.route === "coach") {
    const coach = page.value;
    content = <CoachView value={coach} busy={busy} onExport={async () => {
      if (coach.session_id === undefined) throw new ApiError("EXPORT_REJECTED", "No Coach checkpoint is active.");
      const response = await postResponse("/api/v1/coach/export", { sessionId: coach.session_id });
      if (!response.ok) throw new ApiError("EXPORT_REJECTED", "Coach bundle export failed");
      const blob = await response.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `band8-coach-${coach.checkpoint_id ?? "checkpoint"}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
    }} onImport={async (file) => {
      if (coach.session_id === undefined) throw new ApiError("CONTINUATION_REJECTED", "No Coach checkpoint is active.");
      const result = await mutate<ContinuationImportResponse>(async () => {
        const packageDocument = parseFileJson(await file.text());
        return await postJson("/api/v1/coach/import", { priorSessionId: coach.session_id!, package: packageDocument });
      });
      if (result !== undefined) navigate("train");
    }} onImportTraining={async (packageFile, protectedFile) => {
      await mutate(async () => {
        const packageDocument = parseFileJson(await packageFile.text());
        const protectedEvaluation = protectedFile === undefined ? undefined : parseFileJson(await protectedFile.text());
        return await postJson("/api/v1/packages/import", protectedEvaluation === undefined ? { package: packageDocument } : { package: packageDocument, protectedEvaluation });
      });
    }} />;
  } else {
    content = <SettingsView value={page.value} busy={busy} onChange={async (zone) => { await mutate(() => postJson("/api/v1/timezone", { operation: settings?.learning_timezone === null ? "configure" : "change", timeZone: zone })); }} />;
  }

  return <div className="app-shell"><a className="skip-link" href="#main">Skip to content</a><header className="topbar"><a className="wordmark" href="#today">BAND8</a><Navigation current={route} /><a className="settings-link" href="#settings" aria-label="Settings">SETTINGS</a></header><ErrorMessage error={error} />{content}</div>;
}
