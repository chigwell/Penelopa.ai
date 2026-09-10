"use client";
import { useEffect, useRef, useState } from "react";
import type { GraphPresentation, GraphPresentationGrouping, KnowledgeEdge, KnowledgeNode, PresentationRequest, PresentationResponse } from "../../lib/knowledge-graph-types";

export function useGraphPresentation(nodes: KnowledgeNode[], edges: KnowledgeEdge[], groupBy: GraphPresentationGrouping, onFailure: () => void) {
  const worker = useRef<Worker | null>(null), revision = useRef(0);
  const latest = useRef({ nodes, edges, groupBy, onFailure }); latest.current = { nodes, edges, groupBy, onFailure };
  const [result, setResult] = useState<{ nodes: KnowledgeNode[]; edges: KnowledgeEdge[]; groupBy: GraphPresentationGrouping; presentation: GraphPresentation }>();
  useEffect(() => {
    const instance = new Worker(new URL("./presentation.worker.ts", import.meta.url), { type: "module" });
    worker.current = instance;
    instance.onerror = () => latest.current.onFailure();
    return () => { revision.current++; instance.terminate(); worker.current = null; };
  }, []);
  useEffect(() => {
    const instance = worker.current;
    if (!instance) return;
    const id = ++revision.current;
    instance.onmessage = (event: MessageEvent<PresentationResponse>) => {
      if (event.data.id !== revision.current || latest.current.nodes !== nodes || latest.current.edges !== edges || latest.current.groupBy !== groupBy) return;
      if ("error" in event.data) latest.current.onFailure();
      else setResult({ nodes, edges, groupBy, presentation: event.data.presentation });
    };
    instance.postMessage({ id, groupBy, nodes: nodes.map(({ id, label, projectId, projectKey }) => ({ id, label, projectId, projectKey })), edges: edges.map(({ id, source, target }) => ({ id, source, target })) } satisfies PresentationRequest);
    return () => { revision.current++; };
  }, [nodes, edges, groupBy]);
  return result?.nodes === nodes && result.edges === edges && result.groupBy === groupBy ? result.presentation : undefined;
}
