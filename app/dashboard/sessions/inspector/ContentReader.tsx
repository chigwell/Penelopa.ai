"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Link as LinkIcon,
  Terminal,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { ApiError } from "../../../lib/penelopa-client";
import type {
  ContentChunk,
  ContentSection,
  CursorPage,
  RelatedEvent,
} from "../../../lib/transcript-types";
import { queryPath } from "../../../lib/transcript-display";
import { DetailSkeleton } from "../../../components/loading/Loading";
import { useTranscriptResource } from "../use-session-access";
import { SessionEmpty, SessionError } from "../SessionChrome";
import { CopyButton } from "./CopyButton";

function ReadableContent({ text, format }: { text: string; format: string }) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [text]);
  const lines = text.split("\n");
  const displayed = expanded ? text : lines.slice(0, 200).join("\n");
  return (
    <>
      {format === "markdown" ? (
        <div className="inspector-markdown">
          <ReactMarkdown
            components={{
              img: ({ alt }) => (
                <span className="session-subtle">
                  [Image: {alt || "attachment"}]
                </span>
              ),
              a: ({ href, children }) => (
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {children}
                  <ExternalLink size={11} />
                </a>
              ),
            }}
          >
            {displayed}
          </ReactMarkdown>
        </div>
      ) : (
        <pre
          className={`inspector-code ${format === "json" ? "is-json" : ""}`}
          tabIndex={0}
        >
          <code>{displayed}</code>
        </pre>
      )}
      {!expanded && lines.length > 200 ? (
        <button className="session-button" onClick={() => setExpanded(true)}>
          Show {lines.length - 200} more lines in this fragment
        </button>
      ) : null}
    </>
  );
}

export function SectionContent({
  token,
  eventId,
  section,
  version,
  onError,
  onOpenEvent,
}: {
  token: string;
  eventId: string;
  section: ContentSection;
  version: string | null;
  onError: (error: ApiError) => void;
  onOpenEvent: (eventId: string, sectionId?: string) => void;
}) {
  const [cursor, setCursor] = useState("");
  const cursors = useRef<string[]>([]);
  const result = useTranscriptResource<ContentChunk>(
    queryPath(
      `/user-read/events/${encodeURIComponent(eventId)}/content/${encodeURIComponent(section.id)}`,
      { cursor, max_chars: 16384 },
    ),
    token,
    onError,
  );
  const related = useTranscriptResource<
    CursorPage<RelatedEvent> & { indexing_pending?: boolean }
  >(
    section.tool_call_id
      ? queryPath(`/user-read/events/${encodeURIComponent(eventId)}/related`, {
          section_id: section.id,
          limit: 50,
        })
      : null,
    token,
    onError,
  );
  const [relatedCursor, setRelatedCursor] = useState("");
  const moreRelated = useTranscriptResource<
    CursorPage<RelatedEvent> & { indexing_pending?: boolean }
  >(
    relatedCursor
      ? queryPath(`/user-read/events/${encodeURIComponent(eventId)}/related`, {
          section_id: section.id,
          cursor: relatedCursor,
          limit: 50,
        })
      : null,
    token,
    onError,
  );
  const visibleRelated = relatedCursor ? moreRelated : related;
  const changed =
    result.data && version && result.data.content_version !== version;
  return (
    <section className="inspector-content" aria-busy={result.loading}>
      <div className="inspector-content-heading">
        <div>
          <h3>{section.label}</h3>
          <span>
            {section.total_chars.toLocaleString("en")}
            {" characters · "}
            {section.format}
          </span>
        </div>
        {result.data ? (
          <CopyButton
            text={result.data.text}
            label={
              !cursor && result.data.complete ? "Copy content" : "Copy fragment"
            }
          />
        ) : null}
      </div>
      {result.loading ? (
        <DetailSkeleton compact />
      ) : result.error ? (
        <SessionError error={result.error} retry={result.reload} />
      ) : changed ? (
        <SessionEmpty
          title="This content changed."
          description="Close and reopen the event to load its current version."
        />
      ) : result.data ? (
        <>
          {cursor ? (
            <p className="content-fragment-note">
              Continued fragment. Formatting may continue from an earlier part.
            </p>
          ) : null}
          <ReadableContent
            text={result.data.text}
            format={
              cursor || !result.data.complete
                ? section.format === "markdown"
                  ? "text"
                  : section.format
                : section.format
            }
          />
          <div className="content-pagination">
            <span>
              {result.data.complete
                ? "End of content"
                : "More content available"}
            </span>
            <div>
              <button
                className="session-button is-small"
                aria-label="Previous content fragment"
                disabled={!cursors.current.length}
                onClick={() => setCursor(cursors.current.pop() || "")}
              >
                <ChevronLeft size={13} />
                Previous
              </button>
              <button
                className="session-button is-small"
                aria-label="Next content fragment"
                disabled={!result.data.next_cursor}
                onClick={() => {
                  cursors.current.push(cursor);
                  setCursor(result.data!.next_cursor!);
                }}
              >
                Continue
                <ChevronRight size={13} />
              </button>
            </div>
          </div>
        </>
      ) : null}
      {section.tool_call_id ? (
        <div className="inspector-related">
          <h4>
            <LinkIcon size={13} />
            Related tool events
          </h4>
          {visibleRelated.data?.indexing_pending ? (
            <p className="session-subtle" role="status">
              Earlier tool references are being indexed. Refresh to check again.
            </p>
          ) : null}
          {visibleRelated.loading ? (
            <p className="session-subtle" role="status">
              Finding related events…
            </p>
          ) : visibleRelated.error ? (
            <p className="session-subtle">
              {"Related events could not be loaded. "}
              <button onClick={visibleRelated.reload}>Retry</button>
            </p>
          ) : visibleRelated.data?.items.length ? (
            <>
              {visibleRelated.data.items.map((item, index) => (
                <button
                  key={`${item.event_id}:${item.section_id}:${index}`}
                  onClick={() => onOpenEvent(item.event_id, item.section_id)}
                >
                  <Terminal size={13} />
                  <span>
                    {item.label ||
                      (item.direction === "output" ||
                      item.kind === "tool_output"
                        ? "Tool result"
                        : "Tool input")}
                  </span>
                  <ExternalLink size={12} />
                </button>
              ))}
              {visibleRelated.data.next_cursor ? (
                <button
                  onClick={() =>
                    setRelatedCursor(visibleRelated.data!.next_cursor!)
                  }
                >
                  More related events
                </button>
              ) : null}
              {relatedCursor ? (
                <button onClick={() => setRelatedCursor("")}>
                  First related events
                </button>
              ) : null}
            </>
          ) : (
            <p className="session-subtle">No related event is available yet.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
