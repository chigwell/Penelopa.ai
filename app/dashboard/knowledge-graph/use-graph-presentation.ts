"use client";
import { useEffect, useRef, useState } from "react";
import type { GraphPresentation, KnowledgeEdge, KnowledgeNode, PresentationRequest, PresentationResponse } from "../../lib/knowledge-graph-types";

export function useGraphPresentation(nodes: KnowledgeNode[], edges: KnowledgeEdge[], onFailure: () => void) {
  const worker = useRef<Worker | null>(null), revision = useRef(0);
  const latest = useRef({ nodes, edges, onFailure }); latest.current = { nodes, edges, onFailure };
  const [result, setResult] = useState<{ nodes: KnowledgeNode[]; edges: KnowledgeEdge[]; presentation: GraphPresentation }>();
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
      if (event.data.id !== revision.current || latest.current.nodes !== nodes || latest.current.edges !== edges) return;
      if ("error" in event.data) latest.current.onFailure();
      else setResult({ nodes, edges, presentation: event.data.presentation });
    };
    instance.postMessage({ id, nodes: nodes.map(({ id, label }) => ({ id, label })), edges: edges.map(({ id, source, target }) => ({ id, source, target })) } satisfies PresentationRequest);
    return () => { revision.current++; };
  }, [nodes, edges]);
  return result?.nodes === nodes && result.edges === edges ? result.presentation : undefined;
}
