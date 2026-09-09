"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Code2, Copy, ExternalLink, FileText, Link as LinkIcon, Terminal, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { ApiError } from "../../lib/penelopa-client";
import type { ContentChunk, ContentSection, CursorPage, EventDetail, ProcessEvidence, ProcessStep, RelatedEvent } from "../../lib/transcript-types";
import { duration, eventLabel, queryPath, shortTime } from "../../lib/transcript-display";
import { copyText } from "../../lib/clipboard";
import { DetailSkeleton } from "../../components/loading/Loading";
import { useTranscriptResource } from "./use-session-access";
import { SessionEmpty, SessionError } from "./SessionChrome";

export function InspectorFrame({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  const [mobile, setMobile] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const media = window.matchMedia("(max-width: 959px)");
    const update = () => setMobile(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!mobile || !dialog.current) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current.showModal();
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = originalOverflow; previous?.focus({ preventScroll: true }); };
  }, [mobile]);
  const content = <><div className="inspector-topline"><span>{title}</span><button className="inspector-close" aria-label="Close details" onClick={onClose}><X size={17} /></button></div>{children}</>;
  return mobile ? <dialog className="session-inspector inspector-dialog" ref={dialog} aria-label={title} onCancel={event => { event.preventDefault(); closeRef.current(); }}>{content}</dialog> : <aside className="session-inspector" aria-label={title}>{content}</aside>;
}

function CopyButton({ text, label = "Copy fragment" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return <button className="session-button is-small" onClick={async () => { await copyText(text); setCopied(true); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(false), 1600); }} aria-label={label}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? "Copied" : label}</button>;
}

function ReadableContent({ text, format }: { text: string; format: string }) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [text]);
  const lines = text.split("\n");
  const displayed = expanded ? text : lines.slice(0, 200).join("\n");
  return <>
    {format === "markdown" ? <div className="inspector-markdown"><ReactMarkdown components={{
      img: ({ alt }) => <span className="session-subtle">[Image: {alt || "attachment"}]</span>,
      a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}<ExternalLink size={11} /></a>,
    }}>{displayed}</ReactMarkdown></div> : <pre className={`inspector-code ${format === "json" ? "is-json" : ""}`} tabIndex={0}><code>{displayed}</code></pre>}
    {!expanded && lines.length > 200 ? <button className="session-button" onClick={() => setExpanded(true)}>Show {lines.length - 200} more lines in this fragment</button> : null}
  </>;
}

function SectionContent({ token, eventId, section, version, onError, onOpenEvent }: {
  token: string; eventId: string; section: ContentSection; version: string | null; onError: (error: ApiError) => void;
  onOpenEvent: (eventId: string, sectionId?: string) => void;
}) {
  const [cursor, setCursor] = useState("");
  const cursors = useRef<string[]>([]);
  const result = useTranscriptResource<ContentChunk>(queryPath(`/user-read/events/${encodeURIComponent(eventId)}/content/${encodeURIComponent(section.id)}`, { cursor, max_chars: 16384 }), token, onError);
  const related = useTranscriptResource<(CursorPage<RelatedEvent> & { indexing_pending?: boolean })>(section.tool_call_id ? queryPath(`/user-read/events/${encodeURIComponent(eventId)}/related`, { section_id: section.id, limit: 50 }) : null, token, onError);
  const [relatedCursor, setRelatedCursor] = useState("");
  const moreRelated = useTranscriptResource<(CursorPage<RelatedEvent> & { indexing_pending?: boolean })>(relatedCursor ? queryPath(`/user-read/events/${encodeURIComponent(eventId)}/related`, { section_id: section.id, cursor: relatedCursor, limit: 50 }) : null, token, onError);
  const visibleRelated = relatedCursor ? moreRelated : related;
  const changed = result.data && version && result.data.content_version !== version;
  return <section className="inspector-content" aria-busy={result.loading}>
    <div className="inspector-content-heading"><div><h3>{section.label}</h3><span>{section.total_chars.toLocaleString("en")} characters · {section.format}</span></div>{result.data ? <CopyButton text={result.data.text} label={!cursor && result.data.complete ? "Copy content" : "Copy fragment"} /> : null}</div>
    {result.loading ? <DetailSkeleton compact /> : result.error ? <SessionError error={result.error} retry={result.reload} /> : changed ? <SessionEmpty title="This content changed." description="Close and reopen the event to load its current version." /> : result.data ? <>
      {cursor ? <p className="content-fragment-note">Continued fragment. Formatting may continue from an earlier part.</p> : null}
      <ReadableContent text={result.data.text} format={cursor || !result.data.complete ? (section.format === "markdown" ? "text" : section.format) : section.format} />
      <div className="content-pagination"><span>{result.data.complete ? "End of content" : "More content available"}</span><div><button className="session-button is-small" aria-label="Previous content fragment" disabled={!cursors.current.length} onClick={() => setCursor(cursors.current.pop() || "")}><ChevronLeft size={13} />Previous</button><button className="session-button is-small" aria-label="Next content fragment" disabled={!result.data.next_cursor} onClick={() => { cursors.current.push(cursor); setCursor(result.data!.next_cursor!); }}>Continue<ChevronRight size={13} /></button></div></div>
    </> : null}
    {section.tool_call_id ? <div className="inspector-related"><h4><LinkIcon size={13} />Related tool events</h4>{visibleRelated.data?.indexing_pending ? <p className="session-subtle" role="status">Earlier tool references are being indexed. Refresh to check again.</p> : null}{visibleRelated.loading ? <p className="session-subtle" role="status">Finding related events…</p> : visibleRelated.error ? <p className="session-subtle">Related events could not be loaded. <button onClick={visibleRelated.reload}>Retry</button></p> : visibleRelated.data?.items.length ? <>{visibleRelated.data.items.map((item, index) => <button key={`${item.event_id}:${item.section_id}:${index}`} onClick={() => onOpenEvent(item.event_id, item.section_id)}><Terminal size={13} /><span>{item.label || ((item.direction === "output" || item.kind === "tool_output") ? "Tool result" : "Tool input")}</span><ExternalLink size={12} /></button>)}{visibleRelated.data.next_cursor ? <button onClick={() => setRelatedCursor(visibleRelated.data!.next_cursor!)}>More related events</button> : null}{relatedCursor ? <button onClick={() => setRelatedCursor("")}>First related events</button> : null}</> : <p className="session-subtle">No related event is available yet.</p>}</div> : null}
  </section>;
}

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

export function StepInspector({ token, step, onError, onOpenEvent }: { token: string; step: ProcessStep; onError: (error: ApiError) => void; onOpenEvent: (id: string) => void }) {
  const [cursor, setCursor] = useState("");
  const evidence = useTranscriptResource<CursorPage<ProcessEvidence>>(queryPath(`/process/steps/${encodeURIComponent(step.id)}/evidence`, { max_items: 20, cursor }), token, onError);
  return <><header className="inspector-heading"><p className="eyebrow">Process · Step {step.ordinal + 1}</p><h2>{step.title}</h2><div className="inspector-meta"><span>{step.kind}</span><span>{step.status.toLowerCase()}</span></div></header><div className="inspector-content"><p className="step-summary">{step.summary || "This step was identified in the session’s process analysis."}</p>
    {step.resources.length ? <div className="step-resources"><h3>Resources</h3>{step.resources.map(resource => <div key={resource.id}><FileText size={14} /><span>{resource.display_name}<small>{resource.role}</small></span></div>)}</div> : null}
    <div className="step-evidence"><h3>Behind this step</h3><p className="session-subtle">The original events that support this interpretation.</p>{evidence.loading ? <DetailSkeleton compact /> : evidence.error ? <SessionError error={evidence.error} retry={evidence.reload} /> : evidence.data?.items.map(item => <button key={item.id} onClick={() => onOpenEvent(item.event_id)}><span>{item.event_kind} · {shortTime(item.occurred_at)}</span><p>{item.snippet_text}</p><span>Open event<ExternalLink size={12} /></span></button>)}{evidence.data?.next_cursor ? <button className="session-button" onClick={() => setCursor(evidence.data!.next_cursor!)}>More evidence</button> : null}{cursor ? <button className="session-button" onClick={() => setCursor("")}>First evidence</button> : null}{evidence.data && !evidence.data.items.length ? <p className="session-subtle">No retained evidence is available.</p> : null}</div>
  </div></>;
}
