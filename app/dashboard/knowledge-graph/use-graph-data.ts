"use client";
import { useEffect, useRef, useState } from "react";
import { graphCatalog, GraphProjectLoader } from "../../lib/knowledge-graph-client";
import type { GraphFilters, GraphRun, GraphWorkerRequest, GraphWorkerResponse, KnowledgeGraph } from "../../lib/knowledge-graph-types";
import type { ApiError } from "../../lib/penelopa-client";

export function useGraphCatalog(token: string | null, supported: boolean, onError: (error: ApiError) => void, verified: (token: string) => void) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ token: string; runs?: GraphRun[]; error?: Error }>({ token: "" });
  useEffect(() => {
    if (!token || !supported) { setState({ token: "" }); return; }
    const controller = new AbortController(); let live = true;
    setState({ token });
    graphCatalog(token, controller.signal).then(runs => { if (live) { setState({ token, runs }); verified(token); } })
      .catch((error: ApiError) => { if (live) { setState({ token, error }); onError(error); } });
    return () => { live = false; controller.abort(); };
  }, [token, supported, revision, onError, verified]);
  return { runs: state.token === token ? state.runs : undefined, error: state.token === token ? state.error : undefined, revision,
    refresh: () => { setRevision(value => value + 1); window.dispatchEvent(new Event("penelopa-graphs-refresh")); } };
}
type ProjectState = { key: string; status: "loading" | "preparing" | "ready" | "error" | "cancelled"; done: number; total: number; graph?: KnowledgeGraph; error?: Error; filterKey?: string };
export function useGraphProject(token: string | null, project: string, runs: GraphRun[] | undefined, filters: GraphFilters, revision: number, onError: (error: ApiError) => void) {
  const key = `${token}:${project}:${revision}`;
  const filterKey = JSON.stringify(filters);
  const filtersRef = useRef(filters); filtersRef.current = filters;
  const loader = useRef<{ key: string; loader: GraphProjectLoader } | null>(null);
  const worker = useRef<Worker | null>(null), controller = useRef<AbortController | null>(null);
  const sequence = useRef(0), [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ProjectState>({ key: "", status: "loading", done: 0, total: 0 });
  const activeKey = useRef(key); activeKey.current = key;
  useEffect(() => {
    if (!token || !project || !runs) { loader.current = null; setState({ key: "", status: "loading", done: 0, total: 0 }); return; }
    if (loader.current?.key !== key) loader.current = { key, loader: new GraphProjectLoader() };
    const abort = new AbortController(); controller.current = abort;
    let live = true; let localWorker: Worker | null = null;
    const scopedRuns = runs.filter(run => project === "all" || run.project_id === project);
    const update = (value: Partial<ProjectState>) => { if (live && activeKey.current === key) setState(previous => ({ ...previous, ...value, key })); };
    update({ status: "loading", graph: undefined, error: undefined, done: 0, total: scopedRuns.filter(run => run.node_count > 0).length });
    loader.current.loader.load(token, scopedRuns, abort.signal, (done, total) => update({ done, total }))
      .then(snapshots => {
        if (!live || activeKey.current !== key) return;
        update({ status: "preparing" });
        localWorker = new Worker(new URL("./graph.worker.ts", import.meta.url), { type: "module" }); worker.current = localWorker;
        localWorker.onmessage = (event: MessageEvent<GraphWorkerResponse>) => {
          if (event.data.id !== sequence.current) return;
          if ("error" in event.data) update({ status: "error", error: new Error(event.data.error) });
          else update({ status: "ready", graph: event.data.graph, filterKey: JSON.stringify(filtersRef.current) });
        };
        localWorker.onerror = () => update({ status: "error", error: new Error("The graph worker could not start. Retry loading this project.") });
        localWorker.postMessage({ type: "load", id: ++sequence.current, snapshots, filters: filtersRef.current } satisfies GraphWorkerRequest);
      }).catch((error: ApiError) => {
        if (!live || activeKey.current !== key) return;
        update(abort.signal.aborted ? { status: "cancelled" } : { status: "error", error });
        if (!abort.signal.aborted) onError(error);
      });
    return () => { live = false; abort.abort(); localWorker?.terminate(); if (worker.current === localWorker) worker.current = null; };
  }, [token, project, runs, key, attempt, onError]);
  useEffect(() => {
    if (!worker.current) return;
    setState(previous => ({ ...previous, status: "preparing" }));
    worker.current.postMessage({ type: "filter", id: ++sequence.current, filters: filtersRef.current } satisfies GraphWorkerRequest);
  }, [filterKey]);
  return { ...(state.key === key ? state : { key, status: "loading" as const, done: 0, total: 0 }),
    graph: state.key === key && state.filterKey === filterKey ? state.graph : undefined,
    retry: () => setAttempt(value => value + 1), cancel: () => { controller.current?.abort(); worker.current?.terminate(); worker.current = null; setState(previous => ({ ...previous, status: "cancelled" })); } };
}
