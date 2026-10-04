"use client";

import type { RefObject } from "react";
import { ArrowUpRight, GitBranch, Terminal } from "lucide-react";
import type { ApiError } from "../../lib/penelopa-client";
import type { ProcessTimeline } from "../../lib/transcript-types";
import { TimelineSkeleton } from "../../components/loading/Loading";
import { SessionEmpty, SessionError } from "./SessionChrome";
import { CursorPagination } from "./SessionList";

type ProcessTimelineProps = {
  timeline: {
    loading: boolean;
    data: ProcessTimeline | null;
    error: ApiError | null;
    reload: () => void;
  };
  stepId: string;
  update: (values: Record<string, string>, replace?: boolean) => void;
  params: { get: (name: string) => string | null };
  processHistory: RefObject<Map<string, string>>;
};

export function ProcessTimelineView({
  timeline,
  stepId,
  update,
  params,
  processHistory,
}: ProcessTimelineProps) {
  return timeline.loading && !timeline.data ? (
    <TimelineSkeleton rows={6} />
  ) : timeline.error ? (
    timeline.error.status === 404 ? (
      <SessionEmpty
        title="The process overview isn’t ready."
        description="Your original events are available in Events. A process overview appears after the session has been analysed."
      />
    ) : (
      <SessionError error={timeline.error} retry={timeline.reload} />
    )
  ) : timeline.data ? (
    <>
      <div className="process-intro">
        <GitBranch size={20} />
        <div>
          <h2>The shape of your work.</h2>
          <p>
            A derived overview. Open a step to explore the events behind it.
          </p>
        </div>
      </div>
      <ol className="process-timeline">
        {timeline.data.steps.map((step) => (
          <li key={step.id}>
            <button
              aria-current={step.id === stepId ? "true" : undefined}
              onClick={() => update({ step: step.id, event: "", section: "" })}
            >
              <span className="process-step-number">
                {String(step.ordinal + 1).padStart(2, "0")}
              </span>
              <span>
                <small>
                  {step.kind} · {step.status.toLowerCase()}
                </small>
                <strong>{step.title}</strong>
                <p>{step.summary}</p>
                {step.tool_name ? (
                  <em>
                    <Terminal size={11} />
                    {step.tool_name}
                  </em>
                ) : null}
              </span>
              <ArrowUpRight size={14} />
            </button>
          </li>
        ))}
      </ol>
      {!timeline.data.steps.length ? (
        <SessionEmpty
          title="No steps in this overview."
          description="Explore Events for the original transcript."
        />
      ) : null}
      <CursorPagination
        label={`${timeline.data.steps.length} steps shown`}
        previous={
          params.get("after_step")
            ? () =>
                update({
                  after_step:
                    processHistory.current.get(
                      params.get("after_step") || "",
                    ) || "",
                  step: "",
                })
            : undefined
        }
        next={
          timeline.data.next_cursor
            ? () => {
                processHistory.current.set(
                  timeline.data!.next_cursor!,
                  params.get("after_step") || "",
                );
                update({
                  after_step: timeline.data!.next_cursor!,
                  step: "",
                });
              }
            : undefined
        }
      />
    </>
  ) : null;
}
