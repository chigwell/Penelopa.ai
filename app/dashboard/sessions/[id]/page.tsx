"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUpRight, Check, Circle, Clock3, GitBranch, List, MessageSquare, Pause, Play, Search, Sparkles, Terminal, User, X } from "lucide-react";
import type { CursorPage, EventTail, ProcessTimeline, TranscriptEvent, TranscriptSession } from "../../../lib/transcript-types";
import { duration, eventLabel, eventTone, projectName, queryPath, sessionTitle, shortTime, sourceName } from "../../../lib/transcript-display";
import { formatDateTime, formatMetric } from "../../../lib/formatting";
import { DetailSkeleton, TimelineSkeleton } from "../../../components/loading/Loading";
import { SessionBreadcrumb, SessionChrome, SessionEmpty, SessionError } from "../SessionChrome";
import { CursorPagination } from "../SessionList";
import { EventInspector, InspectorFrame, StepInspector } from "../SessionInspector";
import { useSessionAccess, useTranscriptResource } from "../use-session-access";
import { useLiveEvents } from "../use-live-events";
import { SessionGraphLink } from "../../knowledge-graph/GraphLinks";

type Location = { cursor: string; direction: string; at: string };

export default function SessionPage() {
  const routeParams = useParams<{ id: string }>();
  const id = String(routeParams.id || "");
  const params = useSearchParams();
  const router = useRouter();
  const access = useSessionAccess();
  const view = params.get("view") === "process" ? "process" : "events";
  const eventId = params.get("event") || "", sectionId = params.get("section") || "", stepId = params.get("step") || "";
  const cursor = params.get("cursor") || "", direction = params.get("direction") || "forward", atLatest = params.get("at") === "latest";
  const query = params.get("q") || "", actor = params.get("actor") || "", kind = params.get("kind") || "", status = params.get("status") || "", tool = params.get("tool") || "";
  const [searchInput, setSearchInput] = useState(query);
  const [follow, setFollow] = useState(false);
  const [latestLoading, setLatestLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const history = useRef(new Map<string, Location>());
  const [snapshot, setSnapshot] = useState<{ key: string; data: EventTail } | null>(null);
  const snapshotKey = `${access.token || ""}:${id}`;
  const locationKey = (location: Location) => `${query}|${actor}|${kind}|${status}|${tool}|${location.direction}|${location.cursor}|${location.at}`;
  const currentLocation = { cursor, direction, at: atLatest ? "latest" : "" };
  const bottom = useRef<HTMLDivElement>(null);
  const timelineTop = useRef<HTMLDivElement>(null);
  const lastRun = useRef<string | null | undefined>(undefined);
  const lastReset = useRef(0);
  const session = useTranscriptResource<TranscriptSession>(access.supported && id ? `/user-read/sessions/${encodeURIComponent(id)}` : null, access.token, access.onError);
  const live = useLiveEvents(id, access.token, access.supported && session.data?.storage_state === "HOT", access.onError);
  const eventsPath = query ? queryPath("/process/events/search", { session_id: id, query, cursor, limit: 50, kind, tool, status }) : queryPath(`/user-read/sessions/${encodeURIComponent(id)}/events`, { limit: 100, cursor, direction, actor, kind, status, tool, max_chars: 30000 });
  const events = useTranscriptResource<CursorPage<TranscriptEvent>>(access.supported && view === "events" && !atLatest && session.data?.storage_state === "HOT" ? eventsPath : null, access.token, access.onError);
  const timeline = useTranscriptResource<ProcessTimeline>(access.supported && view === "process" && session.data ? queryPath(`/process/sessions/${encodeURIComponent(id)}/timeline`, { limit: 100, after_step: params.get("after_step") }) : null, access.token, access.onError);
  const processHistory = useRef(new Map<string, string>());
  useEffect(() => { if (session.data && access.token) access.verified(access.token); }, [session.data, access.token, access.verified]);
  useEffect(() => { setSearchInput(query); }, [query]);
  const paramsRef = useRef(params.toString()); paramsRef.current = params.toString();
  function update(values: Record<string, string>, replace = false) {
    const next = new URLSearchParams(paramsRef.current);
    Object.entries(values).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    const href = `/dashboard/sessions/${encodeURIComponent(id)}${next.size ? `?${next}` : ""}`;
    if (replace) router.replace(href, { scroll: false }); else router.push(href, { scroll: false });
  }
  useEffect(() => {
    if (searchInput === query) return;
    const timer = setTimeout(() => { history.current.clear(); setFollow(false); update({ q: searchInput.trim(), cursor: "", at: "", direction: "", actor: "" }, true); }, 300);
    return () => clearTimeout(timer);
  }, [searchInput, query]);
  useEffect(() => {
    if (!live.data) return;
    if (lastRun.current !== undefined && lastRun.current !== live.data.analysis_run_id) { processHistory.current.clear(); update({ after_step: "", step: "" }, true); timeline.reload(); session.reload(); setNotice("A newer process overview is available."); }
    lastRun.current = live.data.analysis_run_id;
  }, [live.data?.analysis_run_id]);
  useEffect(() => {
    if (live.resetCount > lastReset.current) { lastReset.current = live.resetCount; setSnapshot(null); history.current.clear(); update({ cursor: "", direction: "" }, true); events.reload(); session.reload(); setNotice("The transcript was updated after a new parse."); }
  }, [live.resetCount]);
  useEffect(() => {
    if (atLatest && live.data && (follow || snapshot?.key !== snapshotKey)) {
      setSnapshot({ key: snapshotKey, data: live.data });
      if (follow) live.acknowledge();
    }
  }, [atLatest, follow, live.data, snapshot?.key, snapshotKey]);
  useEffect(() => {
    if (follow && atLatest && snapshot?.key === snapshotKey) bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [follow, atLatest, snapshot, snapshotKey]);
  useEffect(() => {
    const stop = (event: WheelEvent) => { if (event.deltaY < -3) setFollow(false); };
    const touch = () => setFollow(false);
    const keyboard = (event: KeyboardEvent) => { if (["PageUp", "Home", "ArrowUp"].includes(event.key) && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) setFollow(false); };
    window.addEventListener("keydown", keyboard);
    window.addEventListener("wheel", stop, { passive: true }); window.addEventListener("touchstart", touch, { passive: true });
    return () => { window.removeEventListener("keydown", keyboard); window.removeEventListener("wheel", stop); window.removeEventListener("touchstart", touch); };
  }, []);
  function filter(values: Record<string, string>) { history.current.clear(); setFollow(false); update({ ...values, cursor: "", direction: "", at: "", event: "", section: "", step: "" }); }
  function openEvent(event: string, section = "") { setFollow(false); update({ event, section, step: "" }); }
  async function latest(enableFollow = false) { if (latestLoading) return; setLatestLoading(true); const fresh = await live.refreshBootstrap(); setLatestLoading(false); if (!fresh) return; setSnapshot({ key: snapshotKey, data: fresh }); setFollow(enableFollow); live.acknowledge(); update({ at: "latest", view: "events", cursor: "", direction: "", q: "", actor: "", kind: "", status: "", tool: "", event: "", section: "", step: "" }); }
  function move(next: Location, pop = false) {
    if (!pop) history.current.set(locationKey(next), currentLocation);
    setFollow(false); update({ ...next, event: "", section: "" }); timelineTop.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const displayedTail = snapshot?.key === snapshotKey ? snapshot.data : null;
  const rows = atLatest ? displayedTail?.items : events.data?.items;
  const eventLoading = atLatest ? !displayedTail && !live.error : events.loading;
  const currentStep = timeline.data?.steps.find(step => step.id === stepId);
  const selected = Boolean(eventId || stepId);
  const sessionData = session.data;
  const eventError = atLatest ? live.error : events.error;
  const prior = atLatest ? displayedTail?.history_cursor ? () => move({ cursor: displayedTail.history_cursor!, direction: "backward", at: "" }) : undefined : direction === "backward" && !query ? events.data?.next_cursor ? () => move({ cursor: events.data!.next_cursor!, direction: "backward", at: "" }) : undefined : cursor ? () => move(history.current.get(locationKey(currentLocation)) || { cursor: "", direction: "forward", at: "" }, true) : undefined;
  const next = atLatest ? undefined : direction === "backward" && !query ? () => move(history.current.get(locationKey(currentLocation)) || { cursor: "", direction: "", at: "latest" }, true) : events.data?.next_cursor ? () => move({ cursor: events.data!.next_cursor!, direction: "forward", at: "" }) : undefined;
  return <SessionChrome access={access} detail refresh={() => { session.reload(); events.reload(); timeline.reload(); live.refresh(); }}><div className="session-main session-detail-main">
    <SessionBreadcrumb title={sessionData ? projectName(sessionData.project_key) : undefined} />
    {!access.initialized || session.loading && !sessionData ? <DetailSkeleton /> : session.error && !sessionData ? <SessionError error={session.error} retry={session.reload} /> : sessionData ? <>
      <header className="session-detail-heading"><div className="session-detail-kicker"><span className={`session-source-chip ${/claude/i.test(sessionData.source) ? "is-claude" : ""}`}><Terminal size={13} />{sourceName(sessionData.source)}</span><span title={sessionData.project_key}>{projectName(sessionData.project_key)}</span></div><h1>{sessionTitle(sessionData)}</h1><div className="session-detail-meta"><span><Clock3 size={13} />{formatDateTime(sessionData.first_seen_at)}</span><span><MessageSquare size={13} />{formatMetric(sessionData.event_count)} events</span><span>{sessionData.storage_state === "HOT" ? "Saved transcript" : sessionData.storage_state.toLowerCase()}</span></div></header>
      <div className="session-workspace-toolbar" ref={timelineTop}><div className="session-view-tabs" aria-label="Session view"><button aria-pressed={view === "events"} onClick={() => update({ view: "", step: "", after_step: "" })}><List size={15} />Events</button><button aria-pressed={view === "process"} onClick={() => { setFollow(false); update({ view: "process", event: "", section: "", step: "" }); }}><GitBranch size={15} />Process{sessionData.analysis_run_id ? <span className="process-ready-dot" /> : null}</button></div>
        <SessionGraphLink token={access.token} project={sessionData.project_id} session={id} />
        {sessionData.storage_state === "HOT" ? <div className="session-live-controls"><span className={`session-live-state ${live.error || live.paused ? "is-paused" : ""}`}><i />{live.paused ? "Paused" : live.error ? "Reconnecting" : "Live updates"}</span><button className={`session-button ${follow ? "is-active" : ""}`} aria-pressed={follow} disabled={latestLoading} onClick={() => follow ? setFollow(false) : latest(true)}>{follow ? <Pause size={13} /> : <Play size={13} />}{latestLoading ? "Loading…" : follow ? "Following" : "Follow"}</button></div> : null}
      </div>
      {notice ? <div className="session-notice" role="status"><Sparkles size={14} /><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss update"><X size={13} /></button></div> : null}
      <div className={`session-workspace${selected ? " has-selection" : ""}`}>
        <section className="session-timeline-panel" aria-label={view === "process" ? "Process timeline" : "Event timeline"}>
          {view === "events" ? <>
            <div className="timeline-search"><Search size={15} /><input value={searchInput} onChange={event => setSearchInput(event.target.value)} placeholder="Find a moment…" aria-label="Search session text" />{searchInput ? <button onClick={() => setSearchInput("")} aria-label="Clear search"><X size={13} /></button> : <span>Search transcript</span>}</div>
            <div className="timeline-filters"><label><span className="sr-only">Event type</span><select value={kind || (actor ? `actor:${actor}` : "")} onChange={event => { const value = event.target.value; filter({ kind: value.startsWith("actor:") ? "" : value, actor: value.startsWith("actor:") ? value.slice(6) : "" }); }}><option value="">All events</option>{!query ? <><option value="actor:USER">Your messages</option><option value="actor:ASSISTANT">Assistant</option><option value="actor:TOOL">Tool results</option></> : null}<option value="tool_call">Tool calls</option><option value="problem">Problems</option><option value="verification">Verification</option><option value="other">Other events</option></select></label><label><span className="sr-only">Event status</span><select value={status} onChange={event => filter({ status: event.target.value })}><option value="">Any status</option><option value="FAILED">Failed</option><option value="SUCCEEDED">Succeeded</option><option value="RUNNING">Running</option><option value="CANCELLED">Cancelled</option></select></label><input aria-label="Tool name" placeholder="Tool name" value={tool} onChange={event => filter({ tool: event.target.value })} /></div>
            {query ? <p className="timeline-context">Search results · indexed transcript text · latest received first</p> : <div className="timeline-context"><span>{atLatest ? "Latest events" : "Session history"} · chronological</span>{!atLatest ? <button disabled={latestLoading} onClick={() => latest()}>{latestLoading ? "Opening latest…" : "Jump to latest"}<ArrowDown size={12} /></button> : null}</div>}
            {sessionData.storage_state !== "HOT" ? <SessionEmpty title="This transcript is in storage history." description="Detailed events are no longer available here. Open Process to see any retained overview." /> : eventLoading && !rows ? <TimelineSkeleton rows={7} /> : eventError && !rows ? <SessionError error={eventError} retry={atLatest ? live.refresh : events.reload} /> : rows?.length ? <ol className={`event-timeline${eventLoading ? " session-updating" : ""}`} aria-busy={eventLoading}>{rows.map((event, index) => {
              const tone = eventTone(event), Icon = tone === "user" ? User : tone === "tool" ? Terminal : tone === "assistant" ? Sparkles : Circle;
              return <li key={event.id} className={`event-row tone-${tone}${eventId === event.id ? " is-selected" : ""}`}><button onClick={() => openEvent(event.id)} aria-current={eventId === event.id ? "true" : undefined} onKeyDown={keyEvent => { if (["ArrowDown", "ArrowUp"].includes(keyEvent.key)) { keyEvent.preventDefault(); const nextRow = rows[index + (keyEvent.key === "ArrowDown" ? 1 : -1)]; if (nextRow) { openEvent(nextRow.id); const sibling = keyEvent.key === "ArrowDown" ? keyEvent.currentTarget.closest("li")?.nextElementSibling : keyEvent.currentTarget.closest("li")?.previousElementSibling; (sibling?.querySelector("button") as HTMLButtonElement | null)?.focus(); } } }}><span className="event-node"><Icon size={14} strokeWidth={1.6} /></span><span className="event-body"><span className="event-row-heading"><strong>{eventLabel(event)}</strong><time dateTime={event.occurred_at || event.ingested_at} title={event.occurred_at ? "Event time" : "Received time"}>{shortTime(event.occurred_at || event.ingested_at)}</time></span><span className="event-preview">{event.content_text?.replace(/\s+/g, " ") || (event.exact_payload_available ? "Open to explore this event" : "Content no longer retained")}</span><span className="event-row-footer"><span>{event.event_kind.replaceAll("_", " ")}</span>{event.status ? <span className={`event-status ${event.status === "FAILED" ? "is-error" : ""}`}>{event.status === "SUCCEEDED" ? <Check size={10} /> : null}{event.status.toLowerCase()}</span> : null}{duration(event.duration_ms) ? <span>{duration(event.duration_ms)}</span> : null}{event.content_text_truncated ? <span>Preview</span> : null}</span></span><ArrowUpRight className="event-open" size={14} /></button></li>;
            })}</ol> : <SessionEmpty title={query || kind || actor || status || tool ? "No matching moments." : "The story is still arriving."} description={query || kind || actor || status || tool ? "Try another phrase or loosen your filters." : "Events will appear as captured transcript segments reach the server."} />}
            {eventError && rows ? <p className="timeline-inline-error" role="status">Updates are temporarily unavailable. Your current view is preserved.<button onClick={atLatest ? live.refresh : events.reload}>Retry</button></p> : null}
            {live.newCount && !follow ? <button className="new-events-button" disabled={latestLoading} onClick={() => latest()}><ArrowDown size={14} />{live.newCount} new {live.newCount === 1 ? "event" : "events"}</button> : null}
            {rows ? <CursorPagination busy={eventLoading} label={`${rows.length} events shown`} previous={prior} next={next} /> : null}<div ref={bottom} />
          </> : timeline.loading && !timeline.data ? <TimelineSkeleton rows={6} /> : timeline.error ? timeline.error.status === 404 ? <SessionEmpty title="The process overview isn’t ready." description="Your original events are available in Events. A process overview appears after the session has been analysed." /> : <SessionError error={timeline.error} retry={timeline.reload} /> : timeline.data ? <><div className="process-intro"><GitBranch size={20} /><div><h2>The shape of your work.</h2><p>A derived overview. Open a step to explore the events behind it.</p></div></div><ol className="process-timeline">{timeline.data.steps.map(step => <li key={step.id}><button aria-current={step.id === stepId ? "true" : undefined} onClick={() => update({ step: step.id, event: "", section: "" })}><span className="process-step-number">{String(step.ordinal + 1).padStart(2, "0")}</span><span><small>{step.kind} · {step.status.toLowerCase()}</small><strong>{step.title}</strong><p>{step.summary}</p>{step.tool_name ? <em><Terminal size={11} />{step.tool_name}</em> : null}</span><ArrowUpRight size={14} /></button></li>)}</ol>{!timeline.data.steps.length ? <SessionEmpty title="No steps in this overview." description="Explore Events for the original transcript." /> : null}<CursorPagination label={`${timeline.data.steps.length} steps shown`} previous={params.get("after_step") ? () => update({ after_step: processHistory.current.get(params.get("after_step") || "") || "", step: "" }) : undefined} next={timeline.data.next_cursor ? () => { processHistory.current.set(timeline.data!.next_cursor!, params.get("after_step") || ""); update({ after_step: timeline.data!.next_cursor!, step: "" }); } : undefined} /></> : null}
        </section>
        {selected && access.token ? <InspectorFrame title={eventId ? "Event detail" : "Process step"} onClose={() => update({ event: "", section: "", step: "" })}>{eventId ? <EventInspector key={eventId} token={access.token} eventId={eventId} sectionId={sectionId} onSection={section => update({ section }, true)} onError={access.onError} onOpenEvent={openEvent} /> : currentStep ? <StepInspector key={currentStep.id} token={access.token} step={currentStep} onError={access.onError} onOpenEvent={openEvent} /> : <SessionEmpty title="This step is not in the current view." description="Return to its process page or select a step from the current analysis." />}</InspectorFrame> : <aside className="inspector-placeholder"><div className="inspector-placeholder-art" aria-hidden="true"><span /><span /><span /><Sparkles size={25} strokeWidth={1.1} /></div><p className="eyebrow">Look a little closer</p><h2>Small moments.<br /><em>The whole story.</em></h2><p>Select {view === "process" ? "a step" : "an event"} to explore its details,<br />context, and connections.</p><span className="inspector-key-hint">↑ ↓ to move between events</span></aside>}
      </div>
    </> : null}
  </div></SessionChrome>;
}
