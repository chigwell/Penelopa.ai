"use client";
import { useEffect, useRef, useState } from "react";
import { Cosmograph, type CosmographRef, type CosmographConfig } from "@cosmograph/react";
import { prepareCosmographDataInDuckDB, type WasmDuckDBConnection } from "@cosmograph/cosmograph";
import { AsyncDuckDB, VoidLogger } from "@duckdb/duckdb-wasm";
import { wasmUrl, workerUrl } from "virtual:knowledge-runtime";
import { Maximize2 } from "lucide-react";
import type { KnowledgeEdge, KnowledgeNode } from "../../lib/knowledge-graph-types";
import type { Theme } from "../../lib/use-theme";

type Props = { nodes: KnowledgeNode[]; edges: KnowledgeEdge[]; theme: Theme; selected?: string; matches: string[]; onSelect: (id: string) => void; onFailure: () => void };
export default function GraphCanvas(props: Props) {
  const host = useRef<HTMLDivElement>(null), graph = useRef<CosmographRef>(undefined);
  const ownedGraph = useRef<CosmographRef>(undefined);
  const [connection, setConnection] = useState<WasmDuckDBConnection>(), [mounted, setMounted] = useState<CosmographRef>();
  const [ready, setReady] = useState(false), [settled, setSettled] = useState(false), [revision, setRevision] = useState(0);
  const latest = useRef(props); latest.current = props;
  const live = useRef(false), interacted = useRef(false), pendingFit = useRef(false);
  const config = useRef<CosmographConfig>({}), queue = useRef(Promise.resolve());
  const generation = useRef(0), prepared = useRef<{ release: () => Promise<void> } | undefined>(undefined);
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
        config: { points: { pointIdBy: "id", pointLabelBy: "label" }, ...(props.edges.length ? { links: { linkSourceBy: "source", linkTargetsBy: ["target"], createMissingPoints: false } } : {}) },
        points: { tableName: `kg_points_${current}`, data: props.nodes.map(node => ({ id: node.id, label: node.label })) },
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
  return <div className="kg-canvas" ref={host} data-ready={ready} data-settled={settled} onPointerDown={() => { interacted.current = true; }} onWheel={() => { interacted.current = true; }}>
    {connection ? <Cosmograph className="kg-cosmograph" ref={graph} duckDBConnection={connection} disableLogging onMount={instance => { ownedGraph.current = instance; setMounted(instance); }} /> : null}
    {!ready ? <div className="kg-canvas-loading" role="status">Preparing the interactive canvas…</div> : null}
    <button className="session-button kg-fit" disabled={!ready} onClick={() => { interacted.current = false; fit(); }}><Maximize2 size={14} />Fit graph</button>
    <span className="kg-canvas-hint">Scroll to zoom · drag to explore · select an entity</span>
  </div>;
}
