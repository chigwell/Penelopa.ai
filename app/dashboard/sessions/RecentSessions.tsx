"use client";

import { useEffect, useRef } from "react";
import { hasTranscriptSupport, type ApiError } from "../../lib/penelopa-client";
import type { CursorPage, TranscriptSession } from "../../lib/transcript-types";
import { SessionListSkeleton } from "../../components/loading/Loading";
import { useTranscriptResource } from "./use-session-access";
import { SessionList } from "./SessionList";
import { SessionEmpty, SessionError, SessionLink } from "./SessionChrome";

export function RecentSessions({ token, onAuthExpired, refreshKey }: { token: string; onAuthExpired: () => void; refreshKey?: string | null }) {
  const supported = hasTranscriptSupport();
  const result = useTranscriptResource<CursorPage<TranscriptSession>>(supported ? "/user-read/sessions?limit=5" : null, token);
  const previousRefresh = useRef(refreshKey);
  useEffect(() => { if (refreshKey !== previousRefresh.current) { previousRefresh.current = refreshKey; result.reload(); } }, [refreshKey, result.reload]);
  useEffect(() => { if (result.error?.status === 401) onAuthExpired(); }, [result.error, onAuthExpired]);
  return <section className="recent-sessions" aria-labelledby="recent-sessions-title"><div className="panel-topline"><div><p className="eyebrow">The work behind the work</p><h2 id="recent-sessions-title">Your sessions.</h2></div><SessionLink href="/dashboard/sessions">View all sessions</SessionLink></div>
    {!supported ? <p className="session-subtle">Update & restart in App settings to explore transcripts.</p> : result.loading && !result.data ? <SessionListSkeleton rows={3} /> : result.error ? <SessionError error={result.error as ApiError} retry={result.reload} /> : result.data?.items.length ? <SessionList items={result.data.items} compact /> : <SessionEmpty title="Your next session starts here." description="Keep working with Codex or Claude Code. Your captured sessions will appear here." />}
  </section>;
}
