"use client";

import { useEffect, useRef, useState } from "react";
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
import type {
  CursorPage,
  EventTail,
  ProcessTimeline,
  TranscriptEvent,
  TranscriptSession,
} from "../../../lib/transcript-types";
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
import { useSessionAccess, useTranscriptResource } from "../use-session-access";
import { useLiveEvents } from "../use-live-events";
import { EventTimelineView } from "../EventTimelineView";
import { ProcessTimelineView } from "../ProcessTimelineView";
import {
  readSessionDetailQuery,
  sessionDetailHref,
  sessionEventsPath,
  sessionLocationKey,
  sessionTimelinePath,
  type SessionLocation,
} from "../../../lib/session-navigation";

export default function SessionPage() {
  const routeParams = useParams<{ id: string }>();
  const id = String(routeParams.id || "");
  const params = useSearchParams();
  const router = useRouter();
  const access = useSessionAccess();
  const routeQuery = readSessionDetailQuery(params);
  const {
    view,
    eventId,
    sectionId,
    stepId,
    cursor,
    direction,
    atLatest,
    query,
    actor,
    kind,
    status,
    tool,
  } = routeQuery;
  const [searchInput, setSearchInput] = useState(query);
  const [follow, setFollow] = useState(false);
  const [latestLoading, setLatestLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const history = useRef(new Map<string, SessionLocation>());
  const [snapshot, setSnapshot] = useState<{
    key: string;
    data: EventTail;
  } | null>(null);
  const snapshotKey = `${access.token || ""}:${id}`;
  const locationKey = (location: SessionLocation) =>
    sessionLocationKey(routeQuery, location);
  const currentLocation = { cursor, direction, at: atLatest ? "latest" : "" };
  const bottom = useRef<HTMLDivElement>(null);
  const timelineTop = useRef<HTMLDivElement>(null);
  const lastRun = useRef<string | null | undefined>(undefined);
  const lastReset = useRef(0);
  const session = useTranscriptResource<TranscriptSession>(
    access.supported && id
      ? `/user-read/sessions/${encodeURIComponent(id)}`
      : null,
    access.token,
    access.onError,
  );
  const live = useLiveEvents(
    id,
    access.token,
    access.supported && session.data?.storage_state === "HOT",
    access.onError,
  );
  const eventsPath = sessionEventsPath(id, routeQuery);
  const events = useTranscriptResource<CursorPage<TranscriptEvent>>(
    access.supported &&
      view === "events" &&
      !atLatest &&
      session.data?.storage_state === "HOT"
      ? eventsPath
      : null,
    access.token,
    access.onError,
  );
  const timeline = useTranscriptResource<ProcessTimeline>(
    access.supported && view === "process" && session.data
      ? sessionTimelinePath(id, params.get("after_step"))
      : null,
    access.token,
    access.onError,
  );
  const processHistory = useRef(new Map<string, string>());
  useEffect(() => {
    if (session.data && access.token) access.verified(access.token);
  }, [session.data, access.token, access.verified]);
  useEffect(() => {
    setSearchInput(query);
  }, [query]);
  const paramsRef = useRef(params.toString());
  paramsRef.current = params.toString();
  function update(values: Record<string, string>, replace = false) {
    const href = sessionDetailHref(id, paramsRef.current, values);
    if (replace) router.replace(href, { scroll: false });
    else router.push(href, { scroll: false });
  }
  useEffect(() => {
    if (searchInput === query) return;
    const timer = setTimeout(() => {
      history.current.clear();
      setFollow(false);
      update(
        { q: searchInput.trim(), cursor: "", at: "", direction: "", actor: "" },
        true,
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput, query]);
  useEffect(() => {
    if (!live.data) return;
    if (
      lastRun.current !== undefined &&
      lastRun.current !== live.data.analysis_run_id
    ) {
      processHistory.current.clear();
      update({ after_step: "", step: "" }, true);
      timeline.reload();
      session.reload();
      setNotice("A newer process overview is available.");
    }
    lastRun.current = live.data.analysis_run_id;
  }, [live.data?.analysis_run_id]);
  useEffect(() => {
    if (live.resetCount > lastReset.current) {
      lastReset.current = live.resetCount;
      setSnapshot(null);
      history.current.clear();
      update({ cursor: "", direction: "" }, true);
      events.reload();
      session.reload();
      setNotice("The transcript was updated after a new parse.");
    }
  }, [live.resetCount]);
  useEffect(() => {
    if (atLatest && live.data && (follow || snapshot?.key !== snapshotKey)) {
      setSnapshot({ key: snapshotKey, data: live.data });
      if (follow) live.acknowledge();
    }
  }, [atLatest, follow, live.data, snapshot?.key, snapshotKey]);
  useEffect(() => {
    if (follow && atLatest && snapshot?.key === snapshotKey)
      bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [follow, atLatest, snapshot, snapshotKey]);
  useEffect(() => {
    const stop = (event: WheelEvent) => {
      if (event.deltaY < -3) setFollow(false);
    };
    const touch = () => setFollow(false);
    const keyboard = (event: KeyboardEvent) => {
      if (
        ["PageUp", "Home", "ArrowUp"].includes(event.key) &&
        !(
          event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLTextAreaElement
        )
      )
        setFollow(false);
    };
    window.addEventListener("keydown", keyboard);
    window.addEventListener("wheel", stop, { passive: true });
    window.addEventListener("touchstart", touch, { passive: true });
    return () => {
      window.removeEventListener("keydown", keyboard);
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", touch);
    };
  }, []);
  function filter(values: Record<string, string>) {
    history.current.clear();
    setFollow(false);
    update({
      ...values,
      cursor: "",
      direction: "",
      at: "",
      event: "",
      section: "",
      step: "",
    });
  }
  function openEvent(event: string, section = "") {
    setFollow(false);
    update({ event, section, step: "" });
  }
  async function latest(enableFollow = false) {
    if (latestLoading) return;
    setLatestLoading(true);
    const fresh = await live.refreshBootstrap();
    setLatestLoading(false);
    if (!fresh) return;
    setSnapshot({ key: snapshotKey, data: fresh });
    setFollow(enableFollow);
    live.acknowledge();
    update({
      at: "latest",
      view: "events",
      cursor: "",
      direction: "",
      q: "",
      actor: "",
      kind: "",
      status: "",
      tool: "",
      event: "",
      section: "",
      step: "",
    });
  }
  function move(next: SessionLocation, pop = false) {
    if (!pop) history.current.set(locationKey(next), currentLocation);
    setFollow(false);
    update({ ...next, event: "", section: "" });
    timelineTop.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const displayedTail = snapshot?.key === snapshotKey ? snapshot.data : null;
  const rows = atLatest ? displayedTail?.items : events.data?.items;
  const eventLoading = atLatest
    ? !displayedTail && !live.error
    : events.loading;
  const currentStep = timeline.data?.steps.find((step) => step.id === stepId);
  const selected = Boolean(eventId || stepId);
  const sessionData = session.data;
  const eventError = atLatest ? live.error : events.error;
  const prior = atLatest
    ? displayedTail?.history_cursor
      ? () =>
          move({
            cursor: displayedTail.history_cursor!,
            direction: "backward",
            at: "",
          })
      : undefined
    : direction === "backward" && !query
      ? events.data?.next_cursor
        ? () =>
            move({
              cursor: events.data!.next_cursor!,
              direction: "backward",
              at: "",
            })
        : undefined
      : cursor
        ? () =>
            move(
              history.current.get(locationKey(currentLocation)) || {
                cursor: "",
                direction: "forward",
                at: "",
              },
              true,
            )
        : undefined;
  const next = atLatest
    ? undefined
    : direction === "backward" && !query
      ? () =>
          move(
            history.current.get(locationKey(currentLocation)) || {
              cursor: "",
              direction: "",
              at: "latest",
            },
            true,
          )
      : events.data?.next_cursor
        ? () =>
            move({
              cursor: events.data!.next_cursor!,
              direction: "forward",
              at: "",
            })
        : undefined;
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
