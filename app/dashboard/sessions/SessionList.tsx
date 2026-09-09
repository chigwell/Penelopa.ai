"use client";

import { ArrowUpRight, Check, ChevronLeft, ChevronRight, MessageSquare, Terminal } from "lucide-react";
import Link from "next/link";
import type { TranscriptSession } from "../../lib/transcript-types";
import { projectName, sessionTitle, sourceName } from "../../lib/transcript-display";
import { formatDateTime, formatMetric } from "../../lib/formatting";

export function SessionList({ items, compact = false }: { items: TranscriptSession[]; compact?: boolean }) {
  return <div className={`session-list${compact ? " is-compact" : ""}`}>
    {items.map((session, index) => <Link key={session.id} href={`/dashboard/sessions/${encodeURIComponent(session.id)}`} className="session-row" style={{ "--row-index": Math.min(index, 5) } as React.CSSProperties}>
      <span className={`session-agent-mark ${/claude/i.test(session.source) ? "is-claude" : ""}`} aria-hidden="true">{/claude/i.test(session.source) ? "✳" : <Terminal size={19} strokeWidth={1.4} />}</span>
      <div className="session-row-copy"><div className="session-row-meta"><span>{sourceName(session.source)}</span><span className="session-meta-dot">·</span><span title={session.project_key}>{projectName(session.project_key)}</span></div>
        <h3>{sessionTitle(session)}</h3><div className="session-row-foot"><time dateTime={session.last_seen_at}>{formatDateTime(session.last_seen_at)}</time><span><MessageSquare size={12} />{formatMetric(session.event_count)} events</span></div>
      </div>
      <div className="session-row-status">{session.storage_state !== "HOT" ? <span className="session-badge is-muted">{session.storage_state.toLowerCase()}</span> : session.analysis_run_id ? <span className="session-badge"><Check size={11} />Process ready</span> : <span className="session-badge is-muted">Transcript</span>}<ArrowUpRight className="session-open-arrow" size={19} strokeWidth={1.4} /></div>
    </Link>)}
  </div>;
}

export function CursorPagination({ previous, next, busy = false, label }: { previous?: () => void; next?: () => void; busy?: boolean; label: string }) {
  return <div className="session-pagination"><span>{label}</span><div><button className="session-button" disabled={!previous || busy} onClick={previous} aria-label="Previous page"><ChevronLeft size={14} />Previous</button><button className="session-button" disabled={!next || busy} onClick={next} aria-label="Next page">Next<ChevronRight size={14} /></button></div></div>;
}
