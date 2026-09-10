"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Cosmograph, CosmographProvider, CosmographTimeline, type CosmographRef, type CosmographConfig, type CosmographTimelineConfig, type CosmographTimelineRef } from "@cosmograph/react";
import { prepareCosmographDataInDuckDB, type WasmDuckDBConnection } from "@cosmograph/cosmograph";
import { AsyncDuckDB, VoidLogger } from "@duckdb/duckdb-wasm";
import { wasmUrl, workerUrl } from "virtual:knowledge-runtime";
import { Maximize2 } from "lucide-react";
import type { GraphSelection, KnowledgeEdge, KnowledgeNode } from "../../lib/knowledge-graph-types";
import type { Theme } from "../../lib/use-theme";

type Props = {
  nodes: KnowledgeNode[]; edges: KnowledgeEdge[]; dates: number[]; selection: GraphSelection; theme: Theme;
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
  const host = useRef<HTMLDivElement>(null), graph = useRef<CosmographRef>(undefined);
  const ownedGraph = useRef<CosmographRef>(undefined);
  const [connection, setConnection] = useState<WasmDuckDBConnection>(), [mounted, setMounted] = useState<CosmographRef>();
  const [timeline, setTimeline] = useState<CosmographTimelineRef>();
  const [ready, setReady] = useState(false), [settled, setSettled] = useState(false), [revision, setRevision] = useState(0);
  const latest = useRef(props); latest.current = props;
  const live = useRef(false), interacted = useRef(false), pendingFit = useRef(false);
  const syncingTimeline = useRef(false), timelineInputEnabled = useRef(false);
  const config = useRef<CosmographConfig>({}), queue = useRef(Promise.resolve());
  const generation = useRef(0), prepared = useRef<{ release: () => Promise<void> } | undefined>(undefined);
  const bindTimeline = useCallback((instance: CosmographTimelineRef | null) => setTimeline(instance || undefined), []);
  const duration = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 250;
  const fit = () => {
    const bounds = host.current?.getBoundingClientRect();
    // Keep above-node labels inside the viewport as well as the points themselves.
    const padding = bounds ? Math.max(0.05, 64 / Math.max(1, Math.min(bounds.width, bounds.height))) : 0.1;
    graph.current?.fitView(duration(), padding);
  };
  const palette = () => {
    const css = getComputedStyle(document.documentElement), color = (name: string) => css.getPropertyValue(name).trim();
    return { backgroundColor: color("--canvas"), pointDefaultColor: color("--chart-messages"), pointColorPalette: [color("--chart-messages"), color("--chart-recommendations")], linkDefaultColor: color("--border-strong"), pointLabelColor: color("--text"), hoveredPointLabelColor: color("--text"), focusedPointRingColor: color("--chart-recommendations") };
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
    if (!mounted || !connection) return;
    const current = ++generation.current; let cancelled = false;
    interacted.current = false; pendingFit.current = true; setReady(false); setSettled(false);
    queue.current = queue.current.then(async () => {
      if (cancelled || !live.current) return;
      const next = await prepareCosmographDataInDuckDB({
        duckDBConnection: connection,
        config: { points: { pointIdBy: "id", pointLabelBy: "label", pointIncludeColumns: ["observedAt"] }, ...(props.edges.length ? { links: { linkSourceBy: "source", linkTargetsBy: ["target"], createMissingPoints: false } } : {}) },
        points: { tableName: `kg_points_${current}`, data: props.nodes.map(node => ({ id: node.id, label: node.label, observedAt: new Date(node.observedAt) })) },
        ...(props.edges.length ? { links: { tableName: `kg_links_${current}`, data: props.edges.map(edge => ({ source: edge.source, target: edge.target, relationship: edge.relationship })) } } : {}),
      });
      const release = async () => { await next.dropViews(); await connection.connection!.query(`DROP TABLE IF EXISTS kg_points_${current}; DROP TABLE IF EXISTS kg_links_${current};`); };
      if (cancelled || !live.current || current !== generation.current) { await release(); return; }
      config.current = { ...next.cosmographConfig, ...palette(),
        enableSimulation: true, preservePointPositionsOnDataUpdate: true, spaceDimensions: 2,
        pointDefaultSize: 8, pointSizeStrategy: "degree", pointSizeRange: [8, 15], scalePointsOnZoom: false,
        pointColorStrategy: "degree", linkColorStrategy: "single", linkWidthStrategy: "single", linkDefaultWidth: 1.5, linkOpacity: 0.8, linkDefaultArrows: true,
        showLabels: true, showDynamicLabels: true, pointLabelClassName: "kg-point-label", hoveredPointLabelClassName: "kg-point-label",
        selectPointOnClick: true, selectPointOnLabelClick: true, renderLinks: true, fitViewOnInit: false,
        simulationDecay: 240, randomSeed: "penelopa-knowledge", disableLogging: true,
        licenseKey: import.meta.env.VITE_COSMOGRAPH_LICENSE_KEY || undefined,
        onPointClick: index => { void mounted.getPointIdsByIndices([index]).then(ids => { if (live.current && ids?.[0]) latest.current.onSelect(ids[0]); }).catch(() => {}); },
        onLabelClick: (_index, id) => latest.current.onSelect(id),
        onSimulationEnd: () => { if (!live.current) return; if (pendingFit.current && !interacted.current) fit(); pendingFit.current = false; setSettled(true); },
      };
      await mounted.setConfig(config.current);
      await mounted.dataUploaded();
      const old = prepared.current; prepared.current = { release };
      if (old) await old.release();
      if (!cancelled && live.current) { fit(); setReady(true); setRevision(value => value + 1); }
    }).catch(() => { if (live.current && !cancelled) latest.current.onFailure(); });
    return () => { cancelled = true; };
  }, [mounted, connection, props.nodes, props.edges]);
  useEffect(() => {
    if (!mounted || !ready) return;
    queue.current = queue.current.then(async () => { if (!live.current) return; config.current = { ...config.current, ...palette() }; await mounted.setConfig(config.current); }).catch(() => { if (live.current) latest.current.onFailure(); });
  }, [props.theme, mounted, ready]);
  const matchesKey = JSON.stringify(props.matches);
  useEffect(() => {
    if (!mounted || !ready) return;
    let active = true;
    const ids = props.selected ? [props.selected] : props.matches;
    void mounted.getPointIndicesByIds(ids).then(indices => {
      if (!active || !live.current) return;
      mounted.selectPoints(indices || [], false, Boolean(props.selected));
      if (props.selected && indices?.[0] !== undefined) { interacted.current = true; mounted.zoomToPoint(indices[0], duration(), 2, true); }
    }).catch(() => {});
    return () => { active = false; };
  }, [props.selected, matchesKey, mounted, ready, revision]);
  const datesKey = props.dates.join(",");
  useEffect(() => {
    if (!timeline || !ready) return;
    const next = timelineSelection(props.selection, props.dates);
    syncingTimeline.current = true; timelineInputEnabled.current = false;
    timeline.setSelection(next);
    queueMicrotask(() => { syncingTimeline.current = false; timelineInputEnabled.current = true; });
  }, [timeline, ready, props.selection, datesKey]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let frame = 0;
    const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { if (ready) fit(); }); });
    observer.observe(element);
    const lost = (event: Event) => { event.preventDefault(); latest.current.onFailure(); };
    element.addEventListener("webglcontextlost", lost, true);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); element.removeEventListener("webglcontextlost", lost, true); };
  }, [ready]);
  const expectedSelection = timelineSelection(props.selection, props.dates);
  return <CosmographProvider><div className="kg-canvas" ref={host} data-ready={ready} data-settled={settled}>
    <div className="kg-canvas-main" onPointerDown={() => { interacted.current = true; }} onWheel={() => { interacted.current = true; }}>
      {connection ? <Cosmograph className="kg-cosmograph" ref={graph} duckDBConnection={connection} disableLogging onMount={instance => { ownedGraph.current = instance; setMounted(instance); }} /> : null}
      {!ready ? <div className="kg-canvas-loading" role="status">Preparing the interactive canvas…</div> : null}
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
