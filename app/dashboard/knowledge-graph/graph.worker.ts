import { mergeKnowledgeGraphs } from "../../lib/knowledge-graph-model";
import type { GraphSnapshot, GraphWorkerRequest, GraphWorkerResponse } from "../../lib/knowledge-graph-types";
let snapshots: GraphSnapshot[] = [];
self.onmessage = (event: MessageEvent<GraphWorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === "load") snapshots = request.snapshots;
    self.postMessage({ id: request.id, graph: mergeKnowledgeGraphs(snapshots, request.filters) } satisfies GraphWorkerResponse);
  } catch { self.postMessage({ id: request.id, error: "The knowledge graph could not be prepared. Retry loading this project." } satisfies GraphWorkerResponse); }
};
