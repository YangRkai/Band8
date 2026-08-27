import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiError, getJson, postJson, postResponse } from "./api.js";

type Document = Record<string, any>;
type Route = "today" | "train" | "progress" | "history" | "coach" | "settings";

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

export function Navigation({ current }: { current: Route }): React.JSX.Element {
  return <nav className="primary-nav" aria-label="Primary">
    {primaryRoutes.map((route) => <a key={route.id} href={`#${route.id}`} aria-current={current === route.id ? "page" : undefined}>{route.label}</a>)}
  </nav>;
}

function Goal({ value }: { value: Document }): React.JSX.Element {
  const sections = [
    ["Listening", value.section_minimums?.listening],
    ["Reading", value.section_minimums?.reading],
    ["Writing", value.section_minimums?.writing],
    ["Speaking", value.section_minimums?.speaking],
  ] as const;
  return <section className="goal" aria-labelledby="goal-title">
    <p className="eyebrow" id="goal-title">IELTS TARGET</p>
    <strong>Overall ≥ {Number(value.overall_target).toFixed(1)}</strong>
    {sections.map(([label, target]) => <span key={label}>{label} ≥ {Number(target).toFixed(1)}</span>)}
  </section>;
}

export function TodayView({ value, onNavigate }: { value: Document; onNavigate: (route: Route) => void }): React.JSX.Element {
  return <main id="main" className="page today-page">
    <header className="hero"><p className="brand-mark">B8</p><div><h1>Band8</h1><p>Precision IELTS training</p></div></header>
    <Goal value={value.goal} />
    {value.empty
      ? <section className="mission-card empty-state"><p className="eyebrow">CURRENT MISSION</p><h2>No training package yet.</h2><p>Generate your first Band8 Coach package<br />and import it here.</p><button className="primary" onClick={() => onNavigate("coach")}>GO TO COACH</button></section>
      : <section className="mission-card" aria-live="polite"><p className="eyebrow">CURRENT MISSION</p><h2>{value.mission?.objective}</h2><p>{value.mission?.target_skills?.join(" · ")}</p><strong className="status-chip">{statusLabel(value.mission?.status ?? "EVIDENCE_PENDING")}</strong><button className="primary" onClick={() => onNavigate("train")}>CONTINUE TRAINING</button></section>}
    <aside className="signal-row" aria-label="Current learning signals">
      <span>{value.effective_streak === null ? "Streak calendar not configured" : `${value.effective_streak.total_effective_days} effective training days`}</span>
      <span>{value.last_reveal?.primary_event === null || value.last_reveal === null ? "No reveal yet" : statusLabel(value.last_reveal.primary_event.event_type)}</span>
      <span>Coach: {statusLabel(value.coach_status)}</span>
    </aside>
  </main>;
}

export function RevealView({ value }: { value: Document }): React.JSX.Element {
  const event = value.primary_event?.event_type ?? "SESSION_COMPLETE";
  const copy = event === "PATTERN_BROKEN"
    ? "Confirmed through repeated correction, delayed retrieval, and changed-material transfer."
    : "You improved this in the session. Stable transfer has not been independently proven.";
  return <section className="reveal" aria-live="polite">
    <p className="eyebrow">SESSION REVEAL</p><h2>{statusLabel(event)}</h2><p>{copy}</p>
    <strong>{event === "PATTERN_BROKEN" ? "Qualification confirmed" : "Validation pending"}</strong>
    {(value.supporting_events ?? []).length > 0 && <div><p className="eyebrow">SUPPORTING EVENTS</p><ul>{value.supporting_events.map((supporting: Document) => <li key={supporting.semantic_id ?? supporting.event_type}>{statusLabel(supporting.event_type)}</li>)}</ul></div>}
    {value.qualification_change && <p>Qualification: {statusLabel(value.qualification_change.qualification)}</p>}
    <details><summary>Evidence</summary><p>{(value.evidence_refs ?? []).join(" · ")}</p></details>
  </section>;
}

export function TrainingActivityView({ activity, busy, onSubmit }: {
  activity: Document;
  busy: boolean;
  onSubmit: (response?: Document) => Promise<void>;
}): React.JSX.Element {
  const [selection, setSelection] = useState<string[]>([]);
  const [text, setText] = useState("");
  const words = text.trim().length === 0 ? 0 : text.trim().split(/\s+/u).length;
  if (!["INSTRUCTION", "PRESENT_TEXT", "SELECT", "TEXT_RESPONSE"].includes(activity.type)) {
    return <section className="activity error-panel" role="alert"><h2>UNSUPPORTED_RUNTIME_PRIMITIVE</h2><p>{activity.type}</p><p>{activity.prompt}</p></section>;
  }
  return <section className="activity" aria-labelledby="activity-prompt">
    <p className="eyebrow">CURRENT ACTIVITY</p><h2 id="activity-prompt">{activity.prompt}</h2>
    {(activity.resources ?? []).map((resource: Document) => <div className="resource-text" key={resource.resource_id}>{resource.content}</div>)}
    {activity.type === "SELECT" && <fieldset><legend>{activity.accessibility?.screen_reader_label ?? activity.prompt}</legend>
      {activity.config.options.map((option: Document) => <label className="option" key={option.option_id}><input
        type={activity.config.selection_mode === "one" ? "radio" : "checkbox"}
        name={activity.activity_id}
        value={option.option_id}
        checked={selection.includes(option.option_id)}
        disabled={activity.config.selection_mode !== "one" && !selection.includes(option.option_id) && selection.length >= Number(activity.config.max_selections ?? activity.config.options.length)}
        onChange={() => setSelection(activity.config.selection_mode === "one" ? [option.option_id] : selection.includes(option.option_id) ? selection.filter((item) => item !== option.option_id) : selection.length < Number(activity.config.max_selections ?? activity.config.options.length) ? [...selection, option.option_id] : selection)}
      /><span>{option.label}</span></label>)}</fieldset>}
    {activity.type === "TEXT_RESPONSE" && <div className="writing-field"><label htmlFor={`response-${activity.activity_id}`}>Your response</label><textarea
      id={`response-${activity.activity_id}`}
      value={text}
      minLength={activity.config.min_characters}
      maxLength={activity.config.max_characters}
      onChange={(event) => setText(event.target.value)}
      aria-describedby={`count-${activity.activity_id}`}
    /><p id={`count-${activity.activity_id}`}>Word count: {words}</p></div>}
    <button className="primary" disabled={busy || (activity.type === "SELECT" && (selection.length < Number(activity.config.min_selections ?? 1) || selection.length > Number(activity.config.max_selections ?? activity.config.options.length))) || (activity.type === "TEXT_RESPONSE" && text.length < Number(activity.config.min_characters ?? 0))} onClick={() => void onSubmit(
      activity.type === "SELECT" ? { optionIds: selection } : activity.type === "TEXT_RESPONSE" ? { text } : undefined,
    )}>{busy ? "SUBMITTING" : activity.type === "SELECT" || activity.type === "TEXT_RESPONSE" ? "SUBMIT" : "Continue"}</button>
  </section>;
}

export function TrainingIdleView({ value, onStart, onNavigate }: {
  value: Document | null;
  onStart: () => void;
  onNavigate: (route: Route) => void;
}): React.JSX.Element {
  if (value?.state === "QUARANTINED") return <section className="empty-state error-panel" role="alert"><h1>Evidence integrity issue detected.</h1><p>This session has been isolated and will not contribute to progress.</p></section>;
  if (value?.state === "AWAITING_COACH") return <section className="empty-state"><h1>COACH REVIEW REQUIRED</h1><button className="primary" onClick={() => onNavigate("coach")}>GO TO COACH</button></section>;
  if (value?.state === "COMPLETED") return <section className="empty-state"><h1>SESSION COMPLETED</h1><button className="primary" onClick={() => onNavigate("today")}>RETURN TO TODAY</button></section>;
  return <section className="empty-state"><h1>Training ready</h1><button className="primary" onClick={onStart}>START TRAINING</button></section>;
}

export function CoachView({ value, busy, onExport, onImport, onImportTraining }: {
  value: Document;
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

export function ProgressView({ value }: { value: Document }): React.JSX.Element {
  return <main id="main" className="page"><Goal value={value.goal} /><h1>Progress</h1><section className="list-grid"><article><p className="eyebrow">CURRENT MISSIONS</p>{value.missions.map((mission: Document) => <div key={mission.mission_id}><strong>{mission.target_skills.join(" · ")}</strong><p>{statusLabel(mission.status)}</p></div>)}</article><article><p className="eyebrow">VALIDATED QUALIFICATIONS</p>{value.validated_qualifications.length === 0 ? <strong>EVIDENCE PENDING</strong> : value.validated_qualifications.map((qualification: Document) => <div key={`${qualification.skill_id}:${qualification.error_pattern_id}`}><strong>{qualification.skill_id}</strong><p>{qualification.error_pattern_id} · {statusLabel(qualification.qualification)}</p></div>)}</article><article><p className="eyebrow">RETENTION</p><strong>{statusLabel(value.retention)}</strong></article><article><p className="eyebrow">TRANSFER</p><strong>{statusLabel(value.transfer)}</strong></article><article><p className="eyebrow">PATTERN STATUS</p><strong>{statusLabel(value.pattern_status)}</strong></article></section></main>;
}

export function HistoryView({ value, busy, onLoadMore }: { value: Document; busy: boolean; onLoadMore: () => Promise<void> }): React.JSX.Element {
  return <main id="main" className="page"><h1>History</h1>{value.items.length === 0 ? <p>No sessions yet.</p> : value.items.map((item: Document) => <article className="history-item" key={item.session_id}><p className="eyebrow">{statusLabel(item.state)}</p><h2>{item.objective}</h2><p>{item.target_skills.join(" · ")}</p>{item.artifacts.map((artifact: Document) => <blockquote key={artifact.artifact_id}>{artifact.text}</blockquote>)}{item.reveal && <><p>Reveal: {statusLabel(item.reveal.primary_event?.event_type ?? "SESSION_COMPLETE")}</p>{item.reveal.qualification_change && <p>Qualification: {statusLabel(item.reveal.qualification_change.qualification)}</p>}</>}</article>)}{value.next_cursor !== null && <button className="primary" disabled={busy} onClick={() => void onLoadMore()}>{busy ? "LOADING" : "LOAD MORE"}</button>}</main>;
}

function SettingsView({ value, busy, onChange }: { value: Document; busy: boolean; onChange: (zone: string) => Promise<void> }): React.JSX.Element {
  const [zone, setZone] = useState(value.learning_timezone?.learning_timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  return <main id="main" className="page"><h1>Settings</h1><section className="detail-card"><label htmlFor="timezone">Learning timezone</label><input id="timezone" value={zone} onChange={(event) => setZone(event.target.value)} aria-describedby="timezone-warning" /><p id="timezone-warning">Changing your learning timezone starts a new streak calendar epoch. Historical training and achievements will not be deleted.</p><button className="primary" disabled={busy} onClick={() => void onChange(zone)}>SAVE TIMEZONE</button></section><section className="detail-card"><h2>Workspace information</h2><p className="path-text">{value.data_location}</p><p>Local server · local data only</p></section></main>;
}

function ErrorMessage({ error }: { error: string | null }): React.JSX.Element | null {
  return error === null ? null : <div className="global-error" role="alert">{error}</div>;
}

export function App(): React.JSX.Element {
  const [route, setRoute] = useState<Route>(() => routeFromHash());
  const [value, setValue] = useState<Document | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [settings, setSettings] = useState<Document | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState<Document | null>(null);
  const loadSequence = useRef(0);
  const routeRef = useRef(route);
  const navigate = useCallback((next: Route) => { routeRef.current = next; setLoaded(false); window.location.hash = next; setRoute(next); }, []);
  const load = useCallback(async (targetRoute: Route) => {
    const sequence = ++loadSequence.current;
    setLoaded(false);
    setError(null);
    try {
      const settingsValue = await getJson("/api/v1/settings");
      const path = targetRoute === "train" ? "training" : targetRoute;
      const routeValue = await getJson(`/api/v1/${path}`);
      if (sequence !== loadSequence.current || routeRef.current !== targetRoute) return;
      setSettings(settingsValue);
      setValue(routeValue);
    } catch (caught) {
      if (sequence !== loadSequence.current || routeRef.current !== targetRoute) return;
      setError(caught instanceof ApiError ? `${caught.code}: ${caught.message}` : String(caught));
    } finally {
      if (sequence === loadSequence.current && routeRef.current === targetRoute) setLoaded(true);
    }
  }, []);
  useEffect(() => { const listener = () => { const next = routeFromHash(); routeRef.current = next; setLoaded(false); setRoute(next); }; window.addEventListener("hashchange", listener); return () => window.removeEventListener("hashchange", listener); }, []);
  useEffect(() => { if (route !== "train") setReveal(null); }, [route]);
  useEffect(() => { void load(route); }, [load, route]);
  const mutate = useCallback(async (operation: () => Promise<unknown>): Promise<unknown | undefined> => { setBusy(true); setError(null); try { const result = await operation(); await load(routeRef.current); return result; } catch (caught) { setError(caught instanceof ApiError ? `${caught.code}: ${caught.message}` : String(caught)); return undefined; } finally { setBusy(false); } }, [load]);
  const loadMoreHistory = useCallback(async () => {
    if (routeRef.current !== "history" || value?.next_cursor === null || value?.next_cursor === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const next = await getJson(`/api/v1/history?limit=20&cursor=${encodeURIComponent(String(value.next_cursor))}`);
      if (routeRef.current !== "history" || next === null) return;
      setValue((current) => current === null ? next : {
        ...next,
        items: [...(current.items ?? []), ...(next.items ?? [])],
      });
    } catch (caught) {
      if (routeRef.current === "history") setError(caught instanceof ApiError ? `${caught.code}: ${caught.message}` : String(caught));
    } finally {
      setBusy(false);
    }
  }, [value]);
  const timezoneMissing = settings?.learning_timezone === null;
  const detectedZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  return <div className="app-shell"><a className="skip-link" href="#main">Skip to content</a><header className="topbar"><a className="wordmark" href="#today">BAND8</a><Navigation current={route} /><a className="settings-link" href="#settings" aria-label="Settings">SETTINGS</a></header><ErrorMessage error={error} />
    {timezoneMissing && route !== "settings" ? <main id="main" className="page onboarding"><p className="eyebrow">FIRST RUN</p><h1>Confirm your learning timezone</h1><p>Your browser suggests <strong>{detectedZone}</strong>. Runtime will validate and own the final setting.</p><button className="primary" disabled={busy} onClick={() => void mutate(() => postJson("/api/v1/timezone", { operation: "configure", timeZone: detectedZone }))}>USE {detectedZone}</button></main>
      : !loaded ? <main id="main" className="page"><p>Loading Band8…</p></main>
        : route === "train" ? <main id="main" className="page training-page">{reveal ? <RevealView value={reveal} /> : value?.current_activity ? <><header className="training-context"><p>{value.mission.objective}</p><span>Activity {value.activity_number} of {value.activity_count}</span></header><TrainingActivityView activity={value.current_activity} busy={busy} onSubmit={async (response) => { const result = await mutate(() => postJson("/api/v1/training/complete", { sessionId: value.session_id, ...(response === undefined ? {} : { response }) })) as Document | undefined; if (result?.reveal) setReveal(result.reveal); }} /></> : <TrainingIdleView value={value} onNavigate={navigate} onStart={() => void mutate(() => postJson("/api/v1/sessions/start", value?.session_id ? { sessionId: value.session_id } : value?.package_id ? { packageId: value.package_id } : {}))} />}</main>
          : value === null ? <main id="main" className="page"><p>Band8 projection unavailable.</p></main>
            : route === "today" ? <TodayView value={value} onNavigate={navigate} />
              : route === "progress" ? <ProgressView value={value} />
              : route === "history" ? <HistoryView value={value} busy={busy} onLoadMore={loadMoreHistory} />
                : route === "coach" ? <CoachView value={value} busy={busy} onExport={async () => { const response = await postResponse("/api/v1/coach/export", { sessionId: value.session_id }); if (!response.ok) throw new ApiError("EXPORT_REJECTED", "Coach bundle export failed"); const blob = await response.blob(); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `band8-coach-${value.checkpoint_id}.json`; link.click(); URL.revokeObjectURL(link.href); }} onImport={async (file) => { const result = await mutate(async () => { const packageDocument = JSON.parse(await file.text()) as Document; return await postJson("/api/v1/coach/import", { priorSessionId: value.session_id, package: packageDocument }); }); if (result !== undefined) navigate("train"); }} onImportTraining={async (packageFile, protectedFile) => { await mutate(async () => postJson("/api/v1/packages/import", { package: JSON.parse(await packageFile.text()), ...(protectedFile === undefined ? {} : { protectedEvaluation: JSON.parse(await protectedFile.text()) }) })); }} />
                  : <SettingsView value={value} busy={busy} onChange={async (zone) => { await mutate(() => postJson("/api/v1/timezone", { operation: settings?.learning_timezone === null ? "configure" : "change", timeZone: zone })); }} />}
  </div>;
}
