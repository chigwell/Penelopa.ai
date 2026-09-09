"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, SlidersHorizontal, X } from "lucide-react";
import type { CursorPage, TranscriptSession } from "../../lib/transcript-types";
import { projectName, queryPath } from "../../lib/transcript-display";
import { SessionListSkeleton } from "../../components/loading/Loading";
import { useSessionAccess, useTranscriptResource } from "./use-session-access";
import { SessionChrome, SessionEmpty, SessionError } from "./SessionChrome";
import { CursorPagination, SessionList } from "./SessionList";

export default function SessionsPage() {
  const access = useSessionAccess();
  const params = useSearchParams();
  const router = useRouter();
  const cursor = params.get("cursor") || "";
  const project = params.get("project") || "";
  const source = params.get("source") || "";
  const period = params.get("period") || "";
  const history = useRef(new Map<string, string>());
  const top = useRef<HTMLDivElement>(null);
  const [projectSearch, setProjectSearch] = useState("");
  const [projectOpen, setProjectOpen] = useState(false);
  const [projectCursor, setProjectCursor] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => { const timer = setTimeout(() => (setDebounced(projectSearch.trim()), setProjectCursor("")), 250); return () => clearTimeout(timer); }, [projectSearch]);
  const projects = useTranscriptResource<CursorPage<{ id: string; project_key: string }>>(projectOpen && access.supported ? queryPath("/user-read/projects", { query: debounced, cursor: projectCursor, limit: 20 }) : null, access.token, access.onError);
  // Pin relative dates to the current filter selection so background renders don't invalidate cursors.
  const [range, setRange] = useState<{ period: string; after: string }>({ period: "", after: "" });
  useEffect(() => { setRange({ period, after: ["7", "30", "90"].includes(period) ? new Date(Date.now() - Number(period) * 86400000).toISOString() : "" }); }, [period]);
  const path = queryPath("/user-read/sessions", { limit: 25, cursor, project_key: project, source, last_seen_after: range.period === period ? range.after : "" });
  const result = useTranscriptResource<CursorPage<TranscriptSession>>(access.supported ? path : null, access.token, access.onError);
  useEffect(() => { if (result.data && access.token) access.verified(access.token); }, [result.data, access.token, access.verified]);
  function update(values: Record<string, string>, reset = true) {
    const next = new URLSearchParams(params.toString());
    if (reset) { next.delete("cursor"); history.current.clear(); }
    Object.entries(values).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    router.push(`/dashboard/sessions${next.size ? `?${next}` : ""}`, { scroll: false });
  }
  function changePage(next: string, backwards = false) {
    if (!backwards) history.current.set(next, cursor);
    update({ cursor: next }, false); top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  return <SessionChrome access={access} refresh={result.reload}><div className="session-main" ref={top}>
    <header className="session-library-heading"><div><p className="eyebrow">Your private session library</p><h1>Every step.<br /><em>A clearer picture.</em></h1></div><p>Conversations, tools, and the moments<br /> that moved your work forward.</p></header>
    <div className="session-filter-bar"><div className="session-filter-label"><SlidersHorizontal size={14} /><span>Explore</span></div>
      <div className="session-project-filter"><button className="session-filter-control" aria-expanded={projectOpen} onClick={() => setProjectOpen(open => !open)}><Search size={14} />{project ? projectName(project) : "All projects"}</button>
      {projectOpen ? <div className="session-project-popover"><label><span className="sr-only">Search projects</span><input autoFocus placeholder="Find a project…" value={projectSearch} onChange={event => setProjectSearch(event.target.value)} onKeyDown={event => { if (event.key === "Escape") setProjectOpen(false); }} /></label><button onClick={() => { update({ project: "" }); setProjectOpen(false); }}>All projects</button>{projects.loading ? <p role="status">Finding projects…</p> : projects.error ? <p role="alert">Projects could not be loaded. <button onClick={projects.reload}>Retry</button></p> : projects.data?.items.map(item => <button key={item.id} title={item.project_key} onClick={() => { update({ project: item.project_key }); setProjectOpen(false); }}>{projectName(item.project_key)}<small>{item.project_key}</small></button>)}{projects.data && !projects.data.items.length ? <p>No matching projects.</p> : null}{projects.data?.next_cursor ? <button onClick={() => setProjectCursor(projects.data!.next_cursor!)}>More projects</button> : null}{projectCursor ? <button onClick={() => setProjectCursor("")}>First projects</button> : null}<button className="session-popover-close" onClick={() => setProjectOpen(false)}>Close</button></div> : null}</div>
      <label><span className="sr-only">Agent</span><select aria-label="Agent" className="session-filter-control" value={source} onChange={event => update({ source: event.target.value })}><option value="">All agents</option><option value="codex-openai">Codex</option><option value="claude-anthropic">Claude Code</option></select></label>
      <label><span className="sr-only">Activity period</span><select aria-label="Activity period" className="session-filter-control" value={period} onChange={event => update({ period: event.target.value })}><option value="">Any time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></label>
      {project || source || period ? <button className="session-clear" onClick={() => update({ project: "", source: "", period: "" })}><X size={13} />Clear</button> : null}<span className="session-sort-label">Latest activity first</span>
    </div>
    <section aria-label="Sessions" aria-busy={result.loading} className={result.loading && result.data ? "session-updating" : ""}>
      {(!access.initialized || result.loading) && !result.data ? <SessionListSkeleton rows={6} /> : result.error && !result.data ? <SessionError error={result.error} retry={result.reload} /> : result.data?.items.length ? <SessionList items={result.data.items} /> : <SessionEmpty title={project || source || period ? "A little too specific?" : "A fresh page."} description={project || source || period ? "Try a different project, agent or time period." : "Your captured Codex and Claude Code sessions will appear here. Keep working — we’ll keep the story."} />}
    </section>
    {result.error && result.data ? <p className="timeline-inline-error" role="status">Sessions could not be refreshed. Your current page is preserved. <button onClick={result.reload}>Retry</button></p> : null}
    {result.data ? <CursorPagination busy={result.loading} label={`${result.data.items.length} sessions on this page`} previous={cursor ? () => changePage(history.current.get(cursor) || "", true) : undefined} next={result.data.next_cursor ? () => changePage(result.data!.next_cursor!) : undefined} /> : null}
  </div></SessionChrome>;
}
