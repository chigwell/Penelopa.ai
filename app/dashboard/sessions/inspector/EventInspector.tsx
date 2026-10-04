"use client";

import { useEffect, useState } from "react";
import { ChevronRight, Code2, FileText, Terminal } from "lucide-react";
import type { ApiError } from "../../../lib/penelopa-client";
import type { EventDetail } from "../../../lib/transcript-types";
import { duration, eventLabel, queryPath, shortTime } from "../../../lib/transcript-display";
import { DetailSkeleton } from "../../../components/loading/Loading";
import { useTranscriptResource } from "../use-session-access";
import { SessionEmpty, SessionError } from "../SessionChrome";
import { CopyButton } from "./CopyButton";
import { SectionContent } from "./ContentReader";

export function EventInspector({ token, eventId, sectionId, onSection, onError, onOpenEvent }: { token: string; eventId: string; sectionId: string; onSection: (section: string) => void; onError: (error: ApiError) => void; onOpenEvent: (id: string, section?: string) => void }) {
  const [sectionsCursor, setSectionsCursor] = useState("");
  const result = useTranscriptResource<EventDetail>(queryPath(`/user-read/events/${encodeURIComponent(eventId)}`, { sections_cursor: sectionsCursor || undefined, section_id: sectionsCursor ? undefined : sectionId || undefined, sections_limit: 50 }), token, onError);
  const data = result.data;
  const section = data?.sections.find(item => item.id === sectionId) || (!sectionId ? data?.sections.find(item => item.id !== "raw") || data?.sections[0] : undefined);
  const [permalink, setPermalink] = useState("");
  useEffect(() => { setPermalink(window.location.href); }, [eventId, sectionId]);
  return result.loading && !data ? <DetailSkeleton /> : result.error ? <SessionError error={result.error} retry={result.reload} /> : data ? <>
    {data.is_current === false ? <p className="session-notice">This is a retained earlier version of the event.</p> : null}<header className="inspector-heading"><span className="eyebrow">{data.event.event_kind.replaceAll("_", " ")}</span><h2>{eventLabel(data.event)}</h2><div className="inspector-meta"><span>{shortTime(data.event.occurred_at || data.event.ingested_at)}</span>{!data.event.occurred_at ? <span>received time</span> : null}{data.event.status ? <span className={data.event.status === "FAILED" ? "is-error" : ""}>{data.event.status.toLowerCase()}</span> : null}{duration(data.event.duration_ms) ? <span>{duration(data.event.duration_ms)}</span> : null}</div><CopyButton text={permalink} label="Copy link" /></header>
    {data.sections.length ? <><div className="inspector-tabs" aria-label="Content sections">{data.sections.map(item => <button key={item.id} aria-pressed={section?.id === item.id} onClick={() => { setSectionsCursor(""); onSection(item.id); }}>{item.id === "raw" ? <Code2 size={13} /> : item.kind.startsWith("tool") ? <Terminal size={13} /> : <FileText size={13} />}{item.label}</button>)}</div>
      {data.next_sections_cursor ? <button className="session-button inspector-more-sections" onClick={() => { setSectionsCursor(data.next_sections_cursor!); onSection(""); }}>More message blocks<ChevronRight size={13} /></button> : null}
      {sectionsCursor || sectionId ? <button className="session-button inspector-more-sections" onClick={() => { setSectionsCursor(""); onSection(""); }}>First message blocks</button> : null}
      {section ? <SectionContent key={`${eventId}:${section.id}:${data.content_version}`} token={token} eventId={eventId} section={section} version={data.content_version} onError={onError} onOpenEvent={onOpenEvent} /> : <SessionEmpty title="This block is on another page." description="Open the next message blocks or return to the first page." />}
    </> : <SessionEmpty title="Only the event remains." description="The content is no longer available, but its place in your session is preserved." />}
    <details className="inspector-metadata"><summary>Event metadata</summary><dl><dt>Event ID</dt><dd>{data.event.id}</dd><dt>Source sequence</dt><dd>{data.event.event_seq_decimal}</dd><dt>Epoch</dt><dd>{data.event.epoch}</dd><dt>Type</dt><dd>{data.event.event_type}</dd><dt>Actor</dt><dd>{data.event.actor_type}</dd></dl></details>
  </> : null;
}

