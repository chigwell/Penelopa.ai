"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  Clock3,
  GitBranch,
  List,
  MessageSquare,
  Pause,
  Play,
  Sparkles,
  Terminal,
  X,
} from "lucide-react";
import {
  projectName,
  sessionTitle,
  sourceName,
} from "../../../lib/transcript-display";
import { formatDateTime, formatMetric } from "../../../lib/formatting";
import { DetailSkeleton } from "../../../components/loading/Loading";
import {
  SessionBreadcrumb,
  SessionChrome,
  SessionEmpty,
  SessionError,
} from "../SessionChrome";
import {
  EventInspector,
  InspectorFrame,
  StepInspector,
} from "../SessionInspector";
import { useSessionAccess } from "../use-session-access";
import { useSessionWorkspace } from "../use-session-workspace";
import { EventTimelineView } from "../EventTimelineView";
import { ProcessTimelineView } from "../ProcessTimelineView";

export default function SessionPage() {
  const routeParams = useParams<{ id: string }>();
  const id = String(routeParams.id || "");
  const params = useSearchParams();
  const router = useRouter();
  const access = useSessionAccess();
  const {
    view,
    eventId,
    sectionId,
    stepId,
    atLatest,
    query,
    actor,
    kind,
    status,
    tool,
    searchInput,
    setSearchInput,
    follow,
    setFollow,
    latestLoading,
    notice,
    setNotice,
    bottom,
    timelineTop,
    session,
    live,
    events,
    timeline,
    processHistory,
    update,
    filter,
    openEvent,
    latest,
    rows,
    eventLoading,
    currentStep,
    selected,
    sessionData,
    eventError,
    prior,
    next,
  } = useSessionWorkspace({ id, params, router, access });
  return (
    <SessionChrome
      access={access}
      detail
      refresh={() => {
        session.reload();
        events.reload();
        timeline.reload();
        live.refresh();
      }}
    >
      <div className="session-main session-detail-main">
        <SessionBreadcrumb
          title={sessionData ? projectName(sessionData.project_key) : undefined}
        />
        {!access.initialized || (session.loading && !sessionData) ? (
          <DetailSkeleton />
        ) : session.error && !sessionData ? (
          <SessionError error={session.error} retry={session.reload} />
        ) : sessionData ? (
          <>
            <header className="session-detail-heading">
              <div className="session-detail-kicker">
                <span
                  className={`session-source-chip ${/claude/i.test(sessionData.source) ? "is-claude" : ""}`}
                >
                  <Terminal size={13} />
                  {sourceName(sessionData.source)}
                </span>
                <span title={sessionData.project_key}>
                  {projectName(sessionData.project_key)}
                </span>
              </div>
              <h1>{sessionTitle(sessionData)}</h1>
              <div className="session-detail-meta">
                <span>
                  <Clock3 size={13} />
                  {formatDateTime(sessionData.first_seen_at)}
                </span>
                <span>
                  <MessageSquare size={13} />
                  {formatMetric(sessionData.event_count)} events
                </span>
                <span>
                  {sessionData.storage_state === "HOT"
                    ? "Saved transcript"
                    : sessionData.storage_state.toLowerCase()}
                </span>
              </div>
            </header>
            <div className="session-workspace-toolbar" ref={timelineTop}>
              <div className="session-view-tabs" aria-label="Session view">
                <button
                  aria-pressed={view === "events"}
                  onClick={() => update({ view: "", step: "", after_step: "" })}
                >
                  <List size={15} />
                  Events
                </button>
                <button
                  aria-pressed={view === "process"}
                  onClick={() => {
                    setFollow(false);
                    update({
                      view: "process",
                      event: "",
                      section: "",
                      step: "",
                    });
                  }}
                >
                  <GitBranch size={15} />
                  Process
                  {sessionData.analysis_run_id ? (
                    <span className="process-ready-dot" />
                  ) : null}
                </button>
              </div>
              {sessionData.storage_state === "HOT" ? (
                <div className="session-live-controls">
                  <span
                    className={`session-live-state ${live.error || live.paused ? "is-paused" : ""}`}
                  >
                    <i />
                    {live.paused
                      ? "Paused"
                      : live.error
                        ? "Reconnecting"
                        : "Live updates"}
                  </span>
                  <button
                    className={`session-button ${follow ? "is-active" : ""}`}
                    aria-pressed={follow}
                    disabled={latestLoading}
                    onClick={() => (follow ? setFollow(false) : latest(true))}
                  >
                    {follow ? <Pause size={13} /> : <Play size={13} />}
                    {latestLoading
                      ? "Loading…"
                      : follow
                        ? "Following"
                        : "Follow"}
                  </button>
                </div>
              ) : null}
            </div>
            {notice ? (
              <div className="session-notice" role="status">
                <Sparkles size={14} />
                <span>{notice}</span>
                <button
                  onClick={() => setNotice("")}
                  aria-label="Dismiss update"
                >
                  <X size={13} />
                </button>
              </div>
            ) : null}
            <div
              className={`session-workspace${selected ? " has-selection" : ""}`}
            >
              <section
                className="session-timeline-panel"
                aria-label={
                  view === "process" ? "Process timeline" : "Event timeline"
                }
              >
                {view === "events" ? (
                  <EventTimelineView
                    searchInput={searchInput}
                    setSearchInput={setSearchInput}
                    kind={kind}
                    actor={actor}
                    status={status}
                    tool={tool}
                    filter={filter}
                    query={query}
                    atLatest={atLatest}
                    latestLoading={latestLoading}
                    latest={latest}
                    sessionData={sessionData}
                    eventLoading={eventLoading}
                    rows={rows}
                    eventError={eventError}
                    live={live}
                    events={events}
                    eventId={eventId}
                    openEvent={openEvent}
                    follow={follow}
                    prior={prior}
                    next={next}
                    bottom={bottom}
                  />
                ) : (
                  <ProcessTimelineView
                    timeline={timeline}
                    stepId={stepId}
                    update={update}
                    params={params}
                    processHistory={processHistory}
                  />
                )}
              </section>
              {selected && access.token ? (
                <InspectorFrame
                  title={eventId ? "Event detail" : "Process step"}
                  onClose={() => update({ event: "", section: "", step: "" })}
                >
                  {eventId ? (
                    <EventInspector
                      key={eventId}
                      token={access.token}
                      eventId={eventId}
                      sectionId={sectionId}
                      onSection={(section) => update({ section }, true)}
                      onError={access.onError}
                      onOpenEvent={openEvent}
                    />
                  ) : currentStep ? (
                    <StepInspector
                      key={currentStep.id}
                      token={access.token}
                      step={currentStep}
                      onError={access.onError}
                      onOpenEvent={openEvent}
                    />
                  ) : (
                    <SessionEmpty
                      title="This step is not in the current view."
                      description="Return to its process page or select a step from the current analysis."
                    />
                  )}
                </InspectorFrame>
              ) : (
                <aside className="inspector-placeholder">
                  <div className="inspector-placeholder-art" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                    <Sparkles size={25} strokeWidth={1.1} />
                  </div>
                  <p className="eyebrow">Look a little closer</p>
                  <h2>
                    Small moments.
                    <br />
                    <em>The whole story.</em>
                  </h2>
                  <p>
                    Select {view === "process" ? "a step" : "an event"} to
                    explore its details,
                    <br />
                    context, and connections.
                  </p>
                  <span className="inspector-key-hint">
                    ↑ ↓ to move between events
                  </span>
                </aside>
              )}
            </div>
          </>
        ) : null}
      </div>
    </SessionChrome>
  );
}
