export type GraphRun = {
  id: string; project_id: string; project_key: string; session_id: string; session_key: string;
  source: string; external_session_id: string | null;
  transcript_first_seen_at: string; transcript_last_seen_at: string;
  input_event_watermark: number; input_event_watermark_decimal: string;
  event_count: number; included_event_count: number; skipped_event_count: number;
  content_character_count: number; chunk_count: number; processed_chunk_count: number;
  node_count: number; edge_count: number; graph_schema_version: string;
  graph_created_at: string; graph_updated_at: string; graph_finished_at: string | null;
  graph_activity_at: string; is_current: boolean;
};
export type GraphRuns = { schema_version: string; items: GraphRun[]; next_cursor: string | null; truncated: boolean };
export type GraphRecord = Record<string, unknown>;
export type GraphChunk = GraphRun & {
  nodes: GraphRecord[]; edges: GraphRecord[]; node_total: number; edge_total: number;
  node_next_cursor: string | null; edge_next_cursor: string | null;
  nodes_truncated: boolean; edges_truncated: boolean;
};
export type GraphSnapshot = { run: GraphRun; nodes: GraphRecord[]; edges: GraphRecord[] };
export type GraphOrigin = {
  runId: string; sessionId: string; sessionKey: string; source: string; at: number;
  originalId: string | null; label: string; transcriptStart: string; transcriptEnd: string;
  search: string;
};
export type KnowledgeNode = { id: string; label: string; firstSeen: number; observedAt: number; origins: GraphOrigin[]; search: string };
export type KnowledgeEdge = { id: string; source: string; target: string; relationship: string; firstSeen: number; observedAt: number; origins: GraphOrigin[]; search: string };
export type KnowledgeGraph = { nodes: KnowledgeNode[]; edges: KnowledgeEdge[]; dates: number[]; skipped: number };
export type GraphColor = { light: string; dark: string };
export type PresentedNode = {
  id: string; label: string; degree: number; communityId: string | null; communityLabel: string; color: GraphColor;
};
export type GraphCommunity = { id: string; label: string; count: number; color: GraphColor };
export type GraphPresentation = { nodes: PresentedNode[]; communities: GraphCommunity[]; isolatedCount: number };
export type PresentationRequest = { id: number; nodes: Pick<KnowledgeNode, "id" | "label">[]; edges: Pick<KnowledgeEdge, "id" | "source" | "target">[] };
export type PresentationResponse = { id: number; presentation: GraphPresentation } | { id: number; error: string };
export type GraphFilters = { sessions: string[]; source: string };
export type GraphSelection =
  | { mode: "latest"; at: number }
  | { mode: "range"; from: number; to: number }
  | { mode: "all" };
export type GraphWorkerRequest =
  | { type: "load"; id: number; snapshots: GraphSnapshot[]; filters: GraphFilters }
  | { type: "filter"; id: number; filters: GraphFilters };
export type GraphWorkerResponse = { id: number; graph: KnowledgeGraph } | { id: number; error: string };
