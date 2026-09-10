"use client";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Cosmograph, CosmographProvider, CosmographTimeline, type CosmographRef, type CosmographConfig, type CosmographTimelineConfig, type CosmographTimelineRef } from "@cosmograph/react";
import { prepareCosmographDataInDuckDB, type WasmDuckDBConnection } from "@cosmograph/cosmograph";
import { AsyncDuckDB, VoidLogger } from "@duckdb/duckdb-wasm";
import { wasmUrl, workerUrl } from "virtual:knowledge-runtime";
import { ChevronDown, Maximize2 } from "lucide-react";
import type { GraphPresentation, GraphPresentationGrouping, GraphSelection, KnowledgeEdge, KnowledgeNode } from "../../lib/knowledge-graph-types";
import type { Theme } from "../../lib/use-theme";
import { useGraphPresentation } from "./use-graph-presentation";

type Props = {
  nodes: KnowledgeNode[]; edges: KnowledgeEdge[]; dates: number[]; selection: GraphSelection; theme: Theme;
  groupBy: GraphPresentationGrouping;
  selected?: string; matches: string[]; onSelect: (id: string) => void; onTimelineRange: (from: number, to: number) => void;
  onFailure: () => void;
};
const day = 86_400_000, minute = 60_000;
const dateMode = "date" as NonNullable<CosmographTimelineConfig["mode"]>;
const toMs = (value: number | Date) => value instanceof Date ? value.getTime() : value;
function rangeForLatest(dates: number[], at: number): [Date, Date] {
  if (!Number.isFinite(at)) return [new Date(0), new Date(0)];
  const ordered = [...dates].sort((a, b) => a - b);
  const index = Math.max(0, ordered.findIndex(value => value === at));
  const prev = ordered[index - 1], next = ordered[index + 1];
  const fallback = Math.max(minute, Math.min(next ? next - at : day, prev ? at - prev : day) / 2);
  return [new Date(prev === undefined ? at - fallback : (prev + at) / 2), new Date(next === undefined ? at + fallback : (at + next) / 2)];
}
function timelineSelection(selection: GraphSelection, dates: number[]): [Date, Date] | undefined {
  if (selection.mode === "all") return undefined;
  if (selection.mode === "range") return [new Date(Math.min(selection.from, selection.to)), new Date(Math.max(selection.from, selection.to))];
  return rangeForLatest(dates, selection.at);
}
function timelineExtent(dates: number[]): [number, number] | undefined {
  if (!dates.length) return undefined;
  const first = dates[0], last = dates.at(-1)!;
  return first === last ? [first - day / 2, last + day / 2] : [first, last];
}
function sameSelection(left: [Date, Date] | undefined, right: [Date, Date] | undefined) {
  if (!left || !right) return left === right;
  return Math.abs(left[0].getTime() - right[0].getTime()) < 2 && Math.abs(left[1].getTime() - right[1].getTime()) < 2;
}
function formatTimelineTick(value: number | Date) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(toMs(value)));
}
export default function GraphCanvas(props: Props) {
  const host = useRef<HTMLDivElement>(null), canvasHost = useRef<HTMLDivElement>(null), graph = useRef<CosmographRef>(undefined);
  const presentation = useGraphPresentation(props.nodes, props.edges, props.groupBy, props.onFailure);
  const ownedGraph = useRef<CosmographRef>(undefined);
  const [connection, setConnection] = useState<WasmDuckDBConnection>(), [mounted, setMounted] = useState<CosmographRef>();
  const [timeline, setTimeline] = useState<CosmographTimelineRef>();
  const [ready, setReady] = useState(false), [settled, setSettled] = useState(false), [revision, setRevision] = useState(0);
  const latest = useRef(props); latest.current = props;
  const live = useRef(false), interacted = useRef(false), pendingFit = useRef(false);
  const framedNode = useRef<string | undefined>(undefined);
  const syncingTimeline = useRef(false), timelineInputEnabled = useRef(false);
  const config = useRef<CosmographConfig>({}), queue = useRef(Promise.resolve());
  const generation = useRef(0), prepared = useRef<{ release: () => Promise<void> } | undefined>(undefined);
  const bindTimeline = useCallback((instance: CosmographTimelineRef | null) => setTimeline(instance || undefined), []);
  const duration = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 250;
  const fit = () => {
    const bounds = canvasHost.current?.getBoundingClientRect();
    // Keep above-node labels inside the viewport as well as the points themselves.
    const padding = bounds ? Math.max(0.05, 64 / Math.max(1, Math.min(bounds.width, bounds.height))) : 0.1;
    graph.current?.fitView(duration(), padding);
  };
  const visualStyle = () => {
    const css = getComputedStyle(document.documentElement), color = (name: string) => css.getPropertyValue(name).trim();
    const theme = latest.current.theme, selected = Boolean(latest.current.selected);
    return { backgroundColor: color("--canvas"), pointDefaultColor: color("--muted"),
      pointColorByMap: Object.fromEntries((presentation?.nodes || []).map(node => [node.communityId ?? "__isolated", node.color[theme]])),
      linkDefaultColor: selected ? color("--chart-messages") : theme === "dark" ? "#a5afbd" : "#66768c",
      linkDefaultWidth: selected ? 2.8 : 1.4, linkOpacity: selected ? 0.95 : 0.65, linkGreyoutOpacity: selected ? 0.025 : 0.07,
      hoveredLinkWidthIncrease: selected ? 2.2 : 1.5, pointLabelColor: color("--text"),
      hoveredPointLabelColor: color("--text"), focusedPointRingColor: color("--ink"), hoveredPointRingColor: color("--ink") };
  };
  useEffect(() => {
    live.current = true; let disposed = false;
    const abort = new AbortController(); let database: AsyncDuckDB | undefined, worker: Worker | undefined, blob: string | undefined;
    const probe = document.createElement("canvas"), gl = probe.getContext("webgl2");
    if (!gl) { latest.current.onFailure(); return; }
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    const initialize = async () => {
      const response = await fetch(wasmUrl, { signal: abort.signal });
      if (!response.ok || !response.body) throw new Error("Graph runtime unavailable");
      const bytes = await new Response(response.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
      if (disposed) return;
      blob = URL.createObjectURL(new Blob([bytes], { type: "application/wasm" }));
      worker = new Worker(workerUrl); database = new AsyncDuckDB(new VoidLogger(), worker);
      await database.instantiate(blob);
      URL.revokeObjectURL(blob); blob = undefined;
      if (disposed) { await database.terminate(); return; }
      const connection = await database.connect();
      if (disposed) { await database.terminate(); return; }
      setConnection({ duckdb: database, connection });
    };
    initialize().catch(() => { if (!disposed) latest.current.onFailure(); });
    return () => { disposed = true; live.current = false; abort.abort(); if (blob) URL.revokeObjectURL(blob); void queue.current.finally(async () => { await ownedGraph.current?.destroy().catch(() => {}); await database?.terminate().catch(() => {}); worker?.terminate(); }); };
  }, []);
  useEffect(() => {
    if (!mounted || !connection || !presentation) return;
    const current = ++generation.current; let cancelled = false;
    if (!latest.current.selected) interacted.current = false;
    pendingFit.current = !latest.current.selected; setReady(false); setSettled(false);
    queue.current = queue.current.then(async () => {
      if (cancelled || !live.current) return;
      const next = await prepareCosmographDataInDuckDB({
        duckDBConnection: connection,
        config: { points: { pointIdBy: "id", pointLabelBy: "label", pointSizeBy: "degree", pointLabelWeightBy: "degree", pointColorBy: "community", pointClusterBy: "community", pointClusterStrengthBy: "clusterStrength", pointIncludeColumns: ["observedAt"] }, ...(props.edges.length ? { links: { linkSourceBy: "source", linkTargetsBy: ["target"], createMissingPoints: false } } : {}) },
        points: { tableName: `kg_points_${current}`, data: (() => {
          const byId = new Map(presentation.nodes.map(node => [node.id, node]));
          return props.nodes.map(node => { const visual = byId.get(node.id)!; return { id: node.id, label: node.label, degree: visual.degree, community: visual.communityId ?? "__isolated", clusterStrength: visual.communityId === null ? 0 : 0.35, observedAt: new Date(node.observedAt) }; });
        })() },
        ...(props.edges.length ? { links: { tableName: `kg_links_${current}`, data: props.edges.map(edge => ({ source: edge.source, target: edge.target, relationship: edge.relationship })) } } : {}),
      });
      const release = async () => { await next.dropViews(); await connection.connection!.query(`DROP TABLE IF EXISTS kg_points_${current}; DROP TABLE IF EXISTS kg_links_${current};`); };
      if (cancelled || !live.current || current !== generation.current) { await release(); return; }
      config.current = { ...next.cosmographConfig, ...visualStyle(),
        enableSimulation: true, preservePointPositionsOnDataUpdate: true, spaceDimensions: 2,
        pointDefaultSize: 7, pointSizeStrategy: "auto", pointSizeRange: [7, 20], scalePointsOnZoom: false,
        // Explicit categorical mapping keeps neutral isolates out of the community palette.
        pointColorStrategy: "map", pointGreyoutOpacity: 0.22,
        linkColorStrategy: "single", linkWidthStrategy: "single", linkDefaultArrows: true, linkVisibilityMinTransparency: 0.65,
        showLabels: true, showDynamicLabels: true, pointLabelClassName: "kg-point-label", hoveredPointLabelClassName: "kg-point-label",
        selectPointOnClick: false, selectPointOnLabelClick: false, focusPointOnClick: false, focusPointOnLabelClick: false, resetSelectionOnEmptyCanvasClick: false, renderLinks: true, fitViewOnInit: false,
        simulationDecay: 240, simulationCluster: 0.06, simulationCollision: 0.7, simulationCollisionPadding: 2, randomSeed: "penelopa-knowledge", disableLogging: true,
        licenseKey: import.meta.env.VITE_COSMOGRAPH_LICENSE_KEY || undefined,
        onPointClick: index => { void mounted.getPointIdsByIndices([index]).then(ids => { if (live.current && current === generation.current && ids?.[0]) latest.current.onSelect(ids[0]); }).catch(() => {}); },
        onLabelClick: (_index, id) => latest.current.onSelect(id),
        onBackgroundClick: () => { if (latest.current.selected) latest.current.onSelect(""); },
        onSimulationEnd: () => { if (!live.current) return; if (pendingFit.current && !interacted.current) fit(); pendingFit.current = false; setSettled(true); },
      };
      await mounted.setConfig(config.current);
      await mounted.dataUploaded();
      const old = prepared.current; prepared.current = { release };
      if (old) await old.release();
      if (!cancelled && live.current) { if (!latest.current.selected) fit(); setReady(true); setRevision(value => value + 1); }
    }).catch(() => { if (live.current && !cancelled) latest.current.onFailure(); });
    return () => { cancelled = true; };
  }, [mounted, connection, props.nodes, props.edges, presentation]);
  useEffect(() => {
    if (!mounted || !ready) return;
    queue.current = queue.current.then(async () => { if (!live.current) return; config.current = { ...config.current, ...visualStyle() }; await mounted.setConfig(config.current); }).catch(() => { if (live.current) latest.current.onFailure(); });
  }, [props.theme, props.selected, mounted, ready]);
  const matchesKey = JSON.stringify(props.matches);
  useEffect(() => {
    if (!mounted || !ready) return;
    let active = true;
    if (!props.selected) framedNode.current = undefined;
    void (async () => {
      const indices = await mounted.getPointIndicesByIds(props.selected ? [props.selected] : props.matches);
      if (!active || !live.current) return;
      const index = indices?.[0];
      if (!props.selected || index === undefined) {
        mounted.unselectAll();
        if (indices?.length) mounted.selectPoints(indices, false, false);
        return;
      }
      const neighbors = mounted.getNeighboringPointIndices(index) || [];
      const neighborhood = [...new Set([index, ...neighbors])];
      const links = props.edges.length ? await mounted.getLinksByPointIndices([index]).catch(() => undefined) : undefined;
      if (!active || !live.current) return;
      const rendered = await mounted.getConfig();
      const linkIndices = links?.toArray().map(row => ({
        rowid: Number(row.rowid),
        source: Number(row[rendered.linkSourceIndexBy!]),
        target: Number(row[rendered.linkTargetIndexBy!]),
      })).filter(row => Number.isFinite(row.rowid) && (row.source === index || row.target === index)).map(row => row.rowid) || [];
      mounted.unselectAll();
      mounted.selectPoints(neighborhood, false, false);
      if (linkIndices.length) mounted.selectLinks(linkIndices, true, false);
      mounted.setFocusedPoint(index);
      if (framedNode.current !== props.selected && settled) {
        framedNode.current = props.selected; interacted.current = true; pendingFit.current = false;
        mounted.fitViewByIndices(neighborhood, duration(), 0.15);
      }
    })().catch(() => { if (active && live.current) latest.current.onFailure(); });
    return () => { active = false; };
  }, [props.selected, matchesKey, mounted, ready, revision, settled, connection]);
  const datesKey = props.dates.join(",");
  useEffect(() => {
    if (!timeline || !ready) return;
    const next = timelineSelection(props.selection, props.dates);
    syncingTimeline.current = true; timelineInputEnabled.current = false;
    timeline.setSelection(next);
    queueMicrotask(() => { syncingTimeline.current = false; timelineInputEnabled.current = true; });
  }, [timeline, ready, props.selection, datesKey]);
  useEffect(() => {
    const element = canvasHost.current;
    if (!element) return;
    let frame = 0;
    const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { if (ready && !interacted.current && !latest.current.selected) fit(); }); });
    observer.observe(element);
    const lost = (event: Event) => { event.preventDefault(); latest.current.onFailure(); };
    element.addEventListener("webglcontextlost", lost, true);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); element.removeEventListener("webglcontextlost", lost, true); };
  }, [ready]);
  const expectedSelection = timelineSelection(props.selection, props.dates);
  return <CosmographProvider><div className="kg-canvas" ref={host} data-ready={ready && Boolean(presentation)} data-settled={settled && Boolean(presentation)}>
    <CommunityLegend presentation={presentation} theme={props.theme} groupBy={props.groupBy} />
    <div className="kg-canvas-main" ref={canvasHost} onPointerDown={() => { interacted.current = true; }} onWheel={() => { interacted.current = true; }}>
      {connection ? <Cosmograph className="kg-cosmograph" ref={graph} duckDBConnection={connection} disableLogging onMount={instance => { ownedGraph.current = instance; setMounted(instance); }} /> : null}
      {!ready || !presentation ? <div className="kg-canvas-loading" role="status">{presentation ? "Preparing the interactive canvas…" : "Finding graph communities…"}</div> : null}
      <button className="session-button kg-fit" disabled={!ready} onClick={() => { interacted.current = false; fit(); }}><Maximize2 size={14} />Fit graph</button>
      <span className="kg-canvas-hint">Scroll to zoom · drag to explore · select an entity</span>
    </div>
    {connection ? <CosmographTimeline className="kg-native-timeline" ref={bindTimeline} id="penelopa-knowledge-timeline" accessor="observedAt" mode={dateMode} customExtent={timelineExtent(props.dates)} initialSelection={expectedSelection} preserveSelectionOnUnmount allowSelection highlightSelectedData={false} showAnimationControls={false} barCount={80} formatter={formatTimelineTick} onSelection={selection => {
      if (syncingTimeline.current || !timelineInputEnabled.current) return;
      const next = selection ? [new Date(toMs(selection[0])), new Date(toMs(selection[1]))] as [Date, Date] : undefined;
      if (sameSelection(next, expectedSelection)) return;
      if (next) latest.current.onTimelineRange(next[0].getTime(), next[1].getTime());
    }} /> : null}
  </div></CosmographProvider>;
}

function CommunityLegend({ presentation, theme, groupBy }: { presentation?: GraphPresentation; theme: Theme; groupBy: GraphPresentationGrouping }) {
  const [expanded, setExpanded] = useState(false);
  const communities = presentation?.communities || [];
  const title = groupBy === "project" ? "Projects" : "Communities";
  return <div className={`kg-community-legend${expanded ? " is-expanded" : ""}`}>
    <button className="kg-legend-toggle" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}><span>{title} <small>{communities.length}</small></span><ChevronDown size={14} /></button>
    <span className="kg-legend-title">{title}</span>
    <ul aria-label={`Graph ${title.toLowerCase()}`}>{communities.slice(0, 5).map(community => <li key={community.id} title={`${community.label} · ${community.count} entities`}><i style={{ "--community-color": community.color[theme] } as CSSProperties} /><span>{community.label}</span><small>{community.count}</small></li>)}{communities.length > 5 ? <li className="kg-legend-more">+{communities.length - 5} more</li> : null}{presentation?.isolatedCount ? <li className="kg-legend-more">{presentation.isolatedCount} unconnected</li> : null}</ul>
    <span className="kg-size-key">Larger nodes have more connections</span>
  </div>;
}
