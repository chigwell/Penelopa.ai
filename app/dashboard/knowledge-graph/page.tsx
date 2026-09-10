"use client";
import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Copy, GitBranch, Network, Search, SlidersHorizontal } from "lucide-react";
import { DashboardTopbar, AccessTokenForm } from "../PageChrome";
import { SessionEmpty } from "../sessions/SessionChrome";
import { InspectorFrame } from "../sessions/SessionInspector";
import { useSessionAccess } from "../sessions/use-session-access";
import { useGraphCatalog, useGraphProject } from "./use-graph-data";
import { useTheme } from "../../lib/use-theme";
import { hasKnowledgeGraphSupport, useDesktop } from "../../lib/penelopa-client";
import { graphAtDate, normalizeGraphText } from "../../lib/knowledge-graph-model";
import type { GraphOrigin, KnowledgeEdge, KnowledgeNode } from "../../lib/knowledge-graph-types";
import { formatDateTime } from "../../lib/formatting";
import { projectName, sourceName } from "../../lib/transcript-display";
import { copyText } from "../../lib/clipboard";
import { DetailSkeleton } from "../../components/loading/Loading";

const GraphCanvas = lazy(() => import("./GraphCanvas"));
class CanvasBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
const dateLabel = (at: number) => formatDateTime(new Date(at).toISOString());
const emptyGraph = { nodes: [], edges: [] };

export default function KnowledgeGraphPage() {
  const access = useSessionAccess(), desktop = useDesktop(), { theme, toggleTheme } = useTheme();
  const params = useSearchParams(), router = useRouter();
  const pendingUrl = useRef(params.toString()), navigating = useRef(false);
  if (!navigating.current || params.toString() === pendingUrl.current) { pendingUrl.current = params.toString(); navigating.current = false; }
  useEffect(() => {
    const restore = () => { navigating.current = false; pendingUrl.current = window.location.search.slice(1); };
    window.addEventListener("popstate", restore); return () => window.removeEventListener("popstate", restore);
  }, []);
  const supported = access.initialized && hasKnowledgeGraphSupport();
  const catalog = useGraphCatalog(access.token, supported, access.onError, access.verified);
  const projects = useMemo(() => [...new Map((catalog.runs || []).filter(run => run.node_count > 0).map(run => [run.project_id, run.project_key])).entries()], [catalog.runs]);
  const requestedProject = params.get("project"), project = requestedProject || projects[0]?.[0] || "";
  const sessionsKey = params.getAll("session").sort().join(","), source = params.get("source") || "";
  const filters = useMemo(() => ({ sessions: sessionsKey ? sessionsKey.split(",") : [], source }), [sessionsKey, source]);
  const data = useGraphProject(access.token && supported ? access.token : null, project, catalog.runs, filters, catalog.revision, access.onError);
  const [listMode, setListMode] = useState(false), [canvasFailed, setCanvasFailed] = useState(false), [copied, setCopied] = useState(false);
  const query = params.get("q") || "", edgeQuery = params.get("edge_q") || "", relationship = params.get("relationship") || "";
  const [searchInput, setSearchInput] = useState(query), [edgeInput, setEdgeInput] = useState(edgeQuery);
  const atParam = params.get("at"), requestedAt = atParam ? Date.parse(atParam) : Infinity;
  const dates = data.graph?.dates || [];
  const at = Number.isFinite(requestedAt) ? requestedAt : dates.at(-1) ?? 0;
  const dateIndex = dates.reduce((index, value, current) => value <= at ? current : index, -1);
  const view = useMemo(() => data.graph ? graphAtDate(data.graph, at, edgeQuery, relationship) : emptyGraph, [data.graph, at, edgeQuery, relationship]);
  const matches = useMemo(() => view.nodes.filter(node => !query || node.search.includes(normalizeGraphText(query))), [view.nodes, query]);
  const selected = view.nodes.find(node => node.id === params.get("node"));
  const projectRuns = useMemo(() => catalog.runs?.filter(run => run.project_id === project) || [], [catalog.runs, project]);
  const sessions = [...new Map(projectRuns.map(run => [run.session_id, run.session_key])).entries()];
  const sources = [...new Set(projectRuns.map(run => run.source))];
  const relationships = [...new Set(data.graph?.edges.filter(edge => edge.firstSeen <= at).map(edge => edge.relationship) || [])].sort();

  function update(values: Record<string, string | string[]>, replace = false) {
    const next = new URLSearchParams(pendingUrl.current);
    if (project) next.set("project", project);
    Object.entries(values).forEach(([key, value]) => { next.delete(key); (Array.isArray(value) ? value : [value]).filter(Boolean).forEach(item => next.append(key, item)); });
    const url = `/dashboard/knowledge-graph${next.size ? `?${next}` : ""}`;
    pendingUrl.current = next.toString(); navigating.current = true;
    if (replace) router.replace(url, { scroll: false }); else router.push(url, { scroll: false });
  }
  useEffect(() => { if (catalog.runs && !projects.length) router.replace("/dashboard"); }, [catalog.runs, projects.length, router]);
  useEffect(() => { setSearchInput(query); }, [query]);
  useEffect(() => { setEdgeInput(edgeQuery); }, [edgeQuery]);
  useEffect(() => {
    if (searchInput === query && edgeInput === edgeQuery) return;
    const timer = setTimeout(() => update({ q: searchInput, edge_q: edgeInput }, true), 300);
    return () => clearTimeout(timer);
  }, [searchInput, edgeInput, query, edgeQuery, params.toString()]);
  useEffect(() => {
    // Avoid downloading the visualization bundle at all on devices without WebGL.
    const probe = document.createElement("canvas"), gl = probe.getContext("webgl2");
    setCanvasFailed(!gl); setListMode(false);
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  }, [project]);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(timer); }, [copied]);
  const select = (id: string) => update({ node: id });
  const fallback = <GraphList nodes={matches} edges={view.edges} selected={selected?.id} onSelect={select} reason={canvasFailed ? "The interactive canvas is unavailable. Explore the same knowledge below." : undefined} />;
  return <main className="dashboard-shell kg-shell">
    <DashboardTopbar theme={theme} onThemeToggle={toggleTheme} onLogout={access.token ? access.logout : undefined} onRefresh={access.token && supported ? catalog.refresh : undefined} backHref="/dashboard" backLabel="Dashboard" />
    {!access.initialized ? <DetailSkeleton /> : !access.token ? <section className="token-gate"><div className="token-gate-copy"><p className="eyebrow">Your knowledge</p><h1>See the connections.</h1><p>Sign in to explore what your projects have learned.</p></div><AccessTokenForm desktop={desktop} loading={false} value={access.tokenInput} onChange={access.setTokenInput} error={access.authError} onSubmit={access.signIn} /></section> : !supported ? <SessionEmpty title="A new way to see your work." description="Update & restart in App settings to explore knowledge graphs." icon="refresh" /> : catalog.error ? <GraphError error={catalog.error} retry={catalog.refresh} /> : !catalog.runs ? <div className="session-main"><DetailSkeleton /><p role="status">Finding your knowledge graphs…</p></div> : !projects.length ? null : requestedProject && !projects.some(([id]) => id === project) ? <SessionEmpty title="This project is unavailable." description="Choose an accessible project to explore its knowledge." action={<button className="session-button" onClick={() => update({ project: projects[0][0], session: [], source: "", at: "", node: "" })}>Choose another project</button>} /> : <div className="kg-main">
      <header className="kg-heading"><div><p className="eyebrow"><Network size={14} /> KNOWLEDGE GRAPH</p><h1>Ideas become connections.</h1><p>Explore the knowledge your project has gathered, one discovery at a time.</p></div><button className="session-button" onClick={async () => { const url = new URL(window.location.href); url.hash = ""; url.searchParams.set("project", project); await copyText(url.toString()); setCopied(true); }}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Copied" : "Copy link"}</button></header>
      <div className="kg-toolbar">
        <label>Project<select aria-label="Project" value={project} onChange={event => update({ project: event.target.value, session: [], source: "", at: "", node: "", q: "", edge_q: "", relationship: "" })}>{projects.map(([id, name]) => <option key={id} value={id}>{projectName(name)}</option>)}</select></label>
        <label>Source<select aria-label="Source" value={source} onChange={event => update({ source: event.target.value, node: "" })}><option value="">All sources</option>{sources.map(item => <option key={item} value={item}>{sourceName(item)}</option>)}</select></label>
        <details className="kg-session-filter"><summary><SlidersHorizontal size={14} />{filters.sessions.length ? `${filters.sessions.length} selected sessions` : "All sessions"}</summary><div><button className="session-text-link" onClick={() => update({ session: [], node: "" })}>All sessions</button>{sessions.map(([id, name]) => <label key={id}><input type="checkbox" checked={filters.sessions.includes(id)} onChange={event => update({ session: event.target.checked ? [...filters.sessions, id] : filters.sessions.filter(item => item !== id), node: "" })} />{name}</label>)}</div></details>
        <span className="kg-count" role="status">{data.graph ? `${view.nodes.length.toLocaleString("en")} entities · ${view.edges.length.toLocaleString("en")} connections` : "Loading knowledge…"}</span>
      </div>
      {data.status === "error" ? <GraphError error={data.error!} retry={data.error && "status" in data.error && data.error.status === 404 ? catalog.refresh : data.retry} /> : data.status === "cancelled" ? <SessionEmpty title="Loading paused." description="Your downloaded pages are kept for this project. Resume when you’re ready." action={<button className="session-button" onClick={data.retry}>Resume loading</button>} /> : !data.graph ? <section className="kg-loading" aria-live="polite"><DetailSkeleton compact /><h2>{data.status === "preparing" ? "Connecting the dots…" : "Gathering your knowledge…"}</h2><p>{data.done} of {data.total} graph versions loaded</p><progress max={Math.max(data.total, 1)} value={data.done} aria-label="Graph loading progress" /><button className="session-button" onClick={data.cancel}>Cancel loading</button></section> : <>
        <div className="kg-searchbar"><label><Search size={15} /><input aria-label="Search entities" placeholder="Find an entity…" value={searchInput} onChange={event => setSearchInput(event.target.value)} /></label><label><GitBranch size={15} /><input aria-label="Search connections" placeholder="Search connections…" value={edgeInput} onChange={event => setEdgeInput(event.target.value)} /></label><select aria-label="Relationship" value={relationship} onChange={event => update({ relationship: event.target.value, node: "" })}><option value="">All relationships</option>{relationships.map(item => <option value={item} key={item}>{item}</option>)}</select><button className="session-button" aria-pressed={listMode || canvasFailed} onClick={() => setListMode(value => !value)} disabled={canvasFailed}>{listMode || canvasFailed ? "List view" : "Show list"}</button></div>
        {query ? <div className="kg-search-results" aria-label="Matching entities"><span>{matches.length} matches</span>{matches.slice(0, 30).map(node => <button key={node.id} onClick={() => select(node.id)} aria-pressed={node.id === selected?.id}>{node.label}</button>)}{matches.length > 30 ? <button onClick={() => setListMode(true)}>Explore all matches</button> : null}</div> : null}
        <div className={`kg-workspace${selected ? " has-selection" : ""}`}>
          <section className="kg-stage" aria-label="Project knowledge graph">
            {!view.nodes.length ? <SessionEmpty title="No knowledge in this view." description="Choose a later date or adjust the session, source and connection filters." /> : listMode || canvasFailed ? fallback : <CanvasBoundary key={project} fallback={<GraphList nodes={matches} edges={view.edges} selected={selected?.id} onSelect={select} reason="The interactive canvas is unavailable. Explore the same knowledge below." />}><Suspense fallback={<div className="kg-loading" role="status">Preparing the interactive canvas…</div>}><GraphCanvas nodes={view.nodes} edges={view.edges} theme={theme} selected={selected?.id} matches={query ? matches.map(node => node.id) : []} onSelect={select} onFailure={() => setCanvasFailed(true)} /></Suspense></CanvasBoundary>}
          </section>
          {selected ? <InspectorFrame title="Knowledge detail" onClose={() => update({ node: "" })}><GraphInspector node={selected} nodes={view.nodes} edges={view.edges} onSelect={select} /></InspectorFrame> : null}
        </div>
        <section className="kg-timeline" aria-label="Knowledge timeline"><div><span className="eyebrow">ACCUMULATED KNOWLEDGE</span><strong>{dates.length ? dateLabel(at) : "No discoveries for these filters"}</strong><span>Knowledge stays as new discoveries arrive.</span></div><div className="kg-timeline-control"><input type="range" min={0} max={Math.max(0, dates.length - 1)} value={Math.max(0, dateIndex)} disabled={dates.length < 2} aria-label="Knowledge date" aria-valuetext={dates.length ? dateLabel(at) : "No dates"} onChange={event => update({ at: new Date(dates[Number(event.target.value)]).toISOString(), node: "" }, true)} /><div><button className="session-button" disabled={dateIndex <= 0} onClick={() => update({ at: new Date(dates[dateIndex - 1]).toISOString(), node: "" })}><ArrowLeft size={14} />Previous discovery</button><span>{dates.length ? `${Math.max(0, dateIndex + 1)} / ${dates.length}` : "0 / 0"}</span><button className="session-button" disabled={dateIndex >= dates.length - 1 || !dates.length} onClick={() => update({ at: new Date(dates[dateIndex + 1]).toISOString(), node: "" })}>Next discovery<ArrowRight size={14} /></button><button className="session-button" disabled={!atParam} onClick={() => update({ at: "", node: "" })}>Latest</button></div></div></section>
        <footer className="kg-footnote"><span>Available graph history · analysis completion time{data.graph.skipped ? ` · ${data.graph.skipped} invalid elements skipped` : ""}</span><a href="https://cosmograph.app/" target="_blank" rel="noreferrer">Visualization by Cosmograph ↗</a></footer>
      </>}
    </div>}
  </main>;
}

function GraphError({ error, retry }: { error: Error; retry: () => void }) {
  const status = "status" in error ? error.status : null;
  return <SessionEmpty icon="error" title={status === 403 ? "This knowledge is outside your access." : status === 404 ? "A graph is no longer available." : "Knowledge could not be loaded."} description={status === 404 ? "Refresh the project catalog to get the available history." : error.message} action={<button className="session-button" onClick={retry}>Retry loading</button>} />;
}
function GraphList({ nodes, edges, selected, onSelect, reason }: { nodes: KnowledgeNode[]; edges: KnowledgeEdge[]; selected?: string; onSelect: (id: string) => void; reason?: string }) {
  const [limit, setLimit] = useState(50);
  useEffect(() => setLimit(50), [nodes]);
  const degrees = useMemo(() => { const values = new Map<string, number>(); for (const edge of edges) { values.set(edge.source, (values.get(edge.source) || 0) + 1); values.set(edge.target, (values.get(edge.target) || 0) + 1); } return values; }, [edges]);
  return <div className="kg-list">{reason ? <p role="status">{reason}</p> : null}<h2>Entities & connections</h2>{!nodes.length ? <p>No matching entities.</p> : <ul>{nodes.slice(0, limit).map(node => <li key={node.id}><button aria-pressed={selected === node.id} onClick={() => onSelect(node.id)}><span><Network size={17} /><strong>{node.label}</strong></span><small>{degrees.get(node.id) || 0} connections · {new Set(node.origins.map(origin => origin.sessionId)).size} sessions</small></button></li>)}</ul>}{nodes.length > limit ? <button className="session-button" onClick={() => setLimit(value => value + 50)}>Show more entities</button> : null}</div>;
}
function Origins({ origins }: { origins: GraphOrigin[] }) {
  const [limit, setLimit] = useState(20);
  useEffect(() => setLimit(20), [origins]);
  return <><ul className="kg-origins">{origins.slice(0, limit).map((origin, index) => <li key={`${origin.runId}:${index}`}><Link href={`/dashboard/sessions/${encodeURIComponent(origin.sessionId)}`}>{origin.sessionKey} ↗</Link><span>{sourceName(origin.source)} · {dateLabel(origin.at)}</span><small>Version {origin.runId}</small><small>{origin.originalId ? `Original ID: ${origin.originalId}` : `Original: ${origin.label}`}</small><small>Transcript: {formatDateTime(origin.transcriptStart)} – {formatDateTime(origin.transcriptEnd)}</small></li>)}</ul>{origins.length > limit ? <button className="session-button" onClick={() => setLimit(value => value + 20)}>More sources</button> : null}</>;
}
function GraphInspector({ node, nodes, edges, onSelect }: { node: KnowledgeNode; nodes: KnowledgeNode[]; edges: KnowledgeEdge[]; onSelect: (id: string) => void }) {
  const related = edges.filter(edge => edge.source === node.id || edge.target === node.id);
  const labels = new Map(nodes.map(item => [item.id, item.label]));
  return <div className="kg-inspector"><p className="eyebrow">ENTITY</p><h2>{node.label}</h2><p>First discovered {dateLabel(node.firstSeen)}</p><h3>{related.length} connections</h3><ul className="kg-connections">{related.map(edge => { const outgoing = edge.source === node.id, target = outgoing ? edge.target : edge.source; return <li key={edge.id}><button onClick={() => onSelect(target)}><span>{outgoing ? "→" : "←"} {edge.relationship}</span><strong>{labels.get(target)}</strong></button><details><summary>{new Set(edge.origins.map(origin => origin.sessionId)).size} source sessions</summary><p>First discovered {dateLabel(edge.firstSeen)}</p><Origins origins={edge.origins} /></details></li>; })}</ul><h3>Where this knowledge came from</h3><Origins origins={node.origins} /></div>;
}
