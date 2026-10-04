"use client";

import { useState } from "react";
import { ExternalLink, FileText } from "lucide-react";
import type { ApiError } from "../../../lib/penelopa-client";
import type {
  CursorPage,
  ProcessEvidence,
  ProcessStep,
} from "../../../lib/transcript-types";
import { queryPath, shortTime } from "../../../lib/transcript-display";
import { DetailSkeleton } from "../../../components/loading/Loading";
import { useTranscriptResource } from "../use-session-access";
import { SessionError } from "../SessionChrome";

export function StepInspector({
  token,
  step,
  onError,
  onOpenEvent,
}: {
  token: string;
  step: ProcessStep;
  onError: (error: ApiError) => void;
  onOpenEvent: (id: string) => void;
}) {
  const [cursor, setCursor] = useState("");
  const evidence = useTranscriptResource<CursorPage<ProcessEvidence>>(
    queryPath(`/process/steps/${encodeURIComponent(step.id)}/evidence`, {
      max_items: 20,
      cursor,
    }),
    token,
    onError,
  );
  return (
    <>
      <header className="inspector-heading">
        <p className="eyebrow">Process · Step {step.ordinal + 1}</p>
        <h2>{step.title}</h2>
        <div className="inspector-meta">
          <span>{step.kind}</span>
          <span>{step.status.toLowerCase()}</span>
        </div>
      </header>
      <div className="inspector-content">
        <p className="step-summary">
          {step.summary ||
            "This step was identified in the session’s process analysis."}
        </p>
        {step.resources.length ? (
          <div className="step-resources">
            <h3>Resources</h3>
            {step.resources.map((resource) => (
              <div key={resource.id}>
                <FileText size={14} />
                <span>
                  {resource.display_name}
                  <small>{resource.role}</small>
                </span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="step-evidence">
          <h3>Behind this step</h3>
          <p className="session-subtle">
            The original events that support this interpretation.
          </p>
          {evidence.loading ? (
            <DetailSkeleton compact />
          ) : evidence.error ? (
            <SessionError error={evidence.error} retry={evidence.reload} />
          ) : (
            evidence.data?.items.map((item) => (
              <button key={item.id} onClick={() => onOpenEvent(item.event_id)}>
                <span>
                  {item.event_kind} · {shortTime(item.occurred_at)}
                </span>
                <p>{item.snippet_text}</p>
                <span>
                  Open event
                  <ExternalLink size={12} />
                </span>
              </button>
            ))
          )}
          {evidence.data?.next_cursor ? (
            <button
              className="session-button"
              onClick={() => setCursor(evidence.data!.next_cursor!)}
            >
              More evidence
            </button>
          ) : null}
          {cursor ? (
            <button className="session-button" onClick={() => setCursor("")}>
              First evidence
            </button>
          ) : null}
          {evidence.data && !evidence.data.items.length ? (
            <p className="session-subtle">No retained evidence is available.</p>
          ) : null}
        </div>
      </div>
    </>
  );
}
