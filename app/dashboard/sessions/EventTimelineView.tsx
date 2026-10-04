"use client";

import type { RefObject } from "react";
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  Circle,
  Search,
  Sparkles,
  Terminal,
  User,
  X,
} from "lucide-react";
import type { ApiError } from "../../lib/penelopa-client";
import type {
  TranscriptEvent,
  TranscriptSession,
} from "../../lib/transcript-types";
import {
  duration,
  eventLabel,
  eventTone,
  shortTime,
} from "../../lib/transcript-display";
import { TimelineSkeleton } from "../../components/loading/Loading";
import { SessionEmpty, SessionError } from "./SessionChrome";
import { CursorPagination } from "./SessionList";

type EventTimelineProps = {
  searchInput: string;
  setSearchInput: (value: string) => void;
  kind: string;
  actor: string;
  status: string;
  tool: string;
  filter: (values: Record<string, string>) => void;
  query: string;
  atLatest: boolean;
  latestLoading: boolean;
  latest: (enableFollow?: boolean) => Promise<void>;
  sessionData: Pick<TranscriptSession, "storage_state">;
  eventLoading: boolean;
  rows: TranscriptEvent[] | undefined;
  eventError: ApiError | null;
  live: { refresh: () => void; newCount: number };
  events: { reload: () => void };
  eventId: string;
  openEvent: (id: string, section?: string) => void;
  follow: boolean;
  prior?: () => void;
  next?: () => void;
  bottom: RefObject<HTMLDivElement | null>;
};

export function EventTimelineView({
  searchInput,
  setSearchInput,
  kind,
  actor,
  status,
  tool,
  filter,
  query,
  atLatest,
  latestLoading,
  latest,
  sessionData,
  eventLoading,
  rows,
  eventError,
  live,
  events,
  eventId,
  openEvent,
  follow,
  prior,
  next,
  bottom,
}: EventTimelineProps) {
  return (
    <>
      <div className="timeline-search">
        <Search size={15} />
        <input
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Find a moment…"
          aria-label="Search session text"
        />
        {searchInput ? (
          <button onClick={() => setSearchInput("")} aria-label="Clear search">
            <X size={13} />
          </button>
        ) : (
          <span>Search transcript</span>
        )}
      </div>
      <div className="timeline-filters">
        <label>
          <span className="sr-only">Event type</span>
          <select
            value={kind || (actor ? `actor:${actor}` : "")}
            onChange={(event) => {
              const value = event.target.value;
              filter({
                kind: value.startsWith("actor:") ? "" : value,
                actor: value.startsWith("actor:") ? value.slice(6) : "",
              });
            }}
          >
            <option value="">All events</option>
            {!query ? (
              <>
                <option value="actor:USER">Your messages</option>
                <option value="actor:ASSISTANT">Assistant</option>
                <option value="actor:TOOL">Tool results</option>
              </>
            ) : null}
            <option value="tool_call">Tool calls</option>
            <option value="problem">Problems</option>
            <option value="verification">Verification</option>
            <option value="other">Other events</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Event status</span>
          <select
            value={status}
            onChange={(event) => filter({ status: event.target.value })}
          >
            <option value="">Any status</option>
            <option value="FAILED">Failed</option>
            <option value="SUCCEEDED">Succeeded</option>
            <option value="RUNNING">Running</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </label>
        <input
          aria-label="Tool name"
          placeholder="Tool name"
          value={tool}
          onChange={(event) => filter({ tool: event.target.value })}
        />
      </div>
      {query ? (
        <p className="timeline-context">
          Search results · indexed transcript text · latest received first
        </p>
      ) : (
        <div className="timeline-context">
          <span>
            {atLatest ? "Latest events" : "Session history"} · chronological
          </span>
          {!atLatest ? (
            <button disabled={latestLoading} onClick={() => latest()}>
              {latestLoading ? "Opening latest…" : "Jump to latest"}
              <ArrowDown size={12} />
            </button>
          ) : null}
        </div>
      )}
      {sessionData.storage_state !== "HOT" ? (
        <SessionEmpty
          title="This transcript is in storage history."
          description="Detailed events are no longer available here. Open Process to see any retained overview."
        />
      ) : eventLoading && !rows ? (
        <TimelineSkeleton rows={7} />
      ) : eventError && !rows ? (
        <SessionError
          error={eventError}
          retry={atLatest ? live.refresh : events.reload}
        />
      ) : rows?.length ? (
        <ol
          className={`event-timeline${eventLoading ? " session-updating" : ""}`}
          aria-busy={eventLoading}
        >
          {rows.map((event, index) => {
            const tone = eventTone(event),
              Icon =
                tone === "user"
                  ? User
                  : tone === "tool"
                    ? Terminal
                    : tone === "assistant"
                      ? Sparkles
                      : Circle;
            return (
              <li
                key={event.id}
                className={`event-row tone-${tone}${eventId === event.id ? " is-selected" : ""}`}
              >
                <button
                  onClick={() => openEvent(event.id)}
                  aria-current={eventId === event.id ? "true" : undefined}
                  onKeyDown={(keyEvent) => {
                    if (["ArrowDown", "ArrowUp"].includes(keyEvent.key)) {
                      keyEvent.preventDefault();
                      const nextRow =
                        rows[index + (keyEvent.key === "ArrowDown" ? 1 : -1)];
                      if (nextRow) {
                        openEvent(nextRow.id);
                        const sibling =
                          keyEvent.key === "ArrowDown"
                            ? keyEvent.currentTarget.closest("li")
                                ?.nextElementSibling
                            : keyEvent.currentTarget.closest("li")
                                ?.previousElementSibling;
                        (
                          sibling?.querySelector(
                            "button",
                          ) as HTMLButtonElement | null
                        )?.focus();
                      }
                    }
                  }}
                >
                  <span className="event-node">
                    <Icon size={14} strokeWidth={1.6} />
                  </span>
                  <span className="event-body">
                    <span className="event-row-heading">
                      <strong>{eventLabel(event)}</strong>
                      <time
                        dateTime={event.occurred_at || event.ingested_at}
                        title={
                          event.occurred_at ? "Event time" : "Received time"
                        }
                      >
                        {shortTime(event.occurred_at || event.ingested_at)}
                      </time>
                    </span>
                    <span className="event-preview">
                      {event.content_text?.replace(/\s+/g, " ") ||
                        (event.exact_payload_available
                          ? "Open to explore this event"
                          : "Content no longer retained")}
                    </span>
                    <span className="event-row-footer">
                      <span>{event.event_kind.replaceAll("_", " ")}</span>
                      {event.status ? (
                        <span
                          className={`event-status ${event.status === "FAILED" ? "is-error" : ""}`}
                        >
                          {event.status === "SUCCEEDED" ? (
                            <Check size={10} />
                          ) : null}
                          {event.status.toLowerCase()}
                        </span>
                      ) : null}
                      {duration(event.duration_ms) ? (
                        <span>{duration(event.duration_ms)}</span>
                      ) : null}
                      {event.content_text_truncated ? (
                        <span>Preview</span>
                      ) : null}
                    </span>
                  </span>
                  <ArrowUpRight className="event-open" size={14} />
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <SessionEmpty
          title={
            query || kind || actor || status || tool
              ? "No matching moments."
              : "The story is still arriving."
          }
          description={
            query || kind || actor || status || tool
              ? "Try another phrase or loosen your filters."
              : "Events will appear as captured transcript segments reach the server."
          }
        />
      )}
      {eventError && rows ? (
        <p className="timeline-inline-error" role="status">
          Updates are temporarily unavailable. Your current view is preserved.
          <button onClick={atLatest ? live.refresh : events.reload}>
            Retry
          </button>
        </p>
      ) : null}
      {live.newCount && !follow ? (
        <button
          className="new-events-button"
          disabled={latestLoading}
          onClick={() => latest()}
        >
          <ArrowDown size={14} />
          {live.newCount}
          {" new "}
          {live.newCount === 1 ? "event" : "events"}
        </button>
      ) : null}
      {rows ? (
        <CursorPagination
          busy={eventLoading}
          label={`${rows.length} events shown`}
          previous={prior}
          next={next}
        />
      ) : null}
      <div ref={bottom} />
    </>
  );
}
