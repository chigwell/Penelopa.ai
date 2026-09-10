import { caseFold } from "unicode-case-folding";
import type { GraphFilters, GraphOrigin, GraphRecord, GraphSelection, GraphSnapshot, KnowledgeEdge, KnowledgeGraph, KnowledgeNode } from "./knowledge-graph-types";

// Python str.split() whitespace, deliberately not JS \s (which also includes BOM).
export function normalizeGraphText(text: string): string {
  return caseFold(text).split(/[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/u).filter(Boolean).join(" ");
}
const text = (value: unknown) => typeof value === "string" ? value : "";
const searchable = (record: GraphRecord) => normalizeGraphText(Object.values(record).map(value => typeof value === "object" ? JSON.stringify(value) : String(value ?? "")).join(" "));
export function mergeKnowledgeGraphs(snapshots: GraphSnapshot[], filters: GraphFilters): KnowledgeGraph {
  const nodes = new Map<string, KnowledgeNode>(), edges = new Map<string, KnowledgeEdge>();
  const dates = new Set<number>(); let skipped = 0;
  const ordered = snapshots.filter(({ run }) => (!filters.source || filters.source === run.source) && (!filters.sessions.length || filters.sessions.includes(run.session_id)))
    .map(snapshot => ({ snapshot, at: Date.parse(snapshot.run.graph_finished_at || snapshot.run.graph_created_at) }))
    .sort((a, b) => a.at - b.at || a.snapshot.run.id.localeCompare(b.snapshot.run.id));
  for (const { snapshot: { run, nodes: rawNodes, edges: rawEdges }, at } of ordered) {
    if (!Number.isFinite(at)) { skipped += rawNodes.length + rawEdges.length; continue; }
    const local = new Map<string, string>();
    const origin = (record: GraphRecord, label: string): GraphOrigin => ({
      runId: run.id, sessionId: run.session_id, sessionKey: run.session_key, source: run.source, at,
      originalId: text(record.id) || null, label, transcriptStart: run.transcript_first_seen_at, transcriptEnd: run.transcript_last_seen_at,
      search: searchable(record),
    });
    for (const raw of rawNodes) {
      const label = text(raw.label), name = normalizeGraphText(label);
      if (!name) { skipped++; continue; }
      const id = JSON.stringify([run.project_id, name]);
      dates.add(at);
      local.set(name, id);
      const existing = nodes.get(id);
      if (existing) { existing.origins.push(origin(raw, label)); existing.search += ` ${searchable(raw)}`; }
      else { nodes.set(id, { id, label, firstSeen: at, observedAt: at, origins: [origin(raw, label)], search: searchable(raw) }); dates.add(at); }
    }
    for (const raw of rawEdges) {
      const source = local.get(normalizeGraphText(text(raw.from))), target = local.get(normalizeGraphText(text(raw.to)));
      const relationship = text(raw.relationship).trim(), kind = normalizeGraphText(relationship);
      if (!source || !target || !kind) { skipped++; continue; }
      const id = JSON.stringify([source, kind, target]);
      const existing = edges.get(id);
      if (existing) { existing.origins.push(origin(raw, relationship)); existing.search += ` ${searchable(raw)}`; }
      else { edges.set(id, { id, source, target, relationship, firstSeen: at, observedAt: at, origins: [origin(raw, relationship)], search: searchable(raw) }); dates.add(at); }
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()], dates: [...dates].sort((a, b) => a - b), skipped };
}
function originsForSelection(origins: GraphOrigin[], selection: GraphSelection) {
  if (selection.mode === "all") return origins;
  if (selection.mode === "latest") return origins.filter(origin => origin.at === selection.at);
  const from = Math.min(selection.from, selection.to), to = Math.max(selection.from, selection.to);
  return origins.filter(origin => origin.at >= from && origin.at <= to);
}
export function graphForSelection(graph: KnowledgeGraph, selection: GraphSelection, edgeQuery = "", relationship = "") {
  const query = normalizeGraphText(edgeQuery), kind = normalizeGraphText(relationship);
  const edges = graph.edges.map(edge => {
      const origins = originsForSelection(edge.origins, selection);
      return { edge, origins };
    })
    .filter(({ edge, origins }) => origins.length && (!query || origins.some(origin => origin.search.includes(query))) && (!kind || normalizeGraphText(edge.relationship) === kind))
    .map(({ edge, origins }) => ({ ...edge, relationship: origins[0].label, firstSeen: origins[0].at, observedAt: origins[0].at, origins, search: origins.map(origin => origin.search).join(" ") }));
  const ids = query || kind ? new Set(edges.flatMap(edge => [edge.source, edge.target])) : null;
  const nodes = graph.nodes.map(node => {
      const origins = originsForSelection(node.origins, selection);
      return { node, origins };
    })
    .filter(({ node, origins }) => origins.length && (!ids || ids.has(node.id)))
    .map(({ node, origins }) => ({ ...node, label: origins[0].label, firstSeen: origins[0].at, observedAt: origins[0].at, origins, search: origins.map(origin => origin.search).join(" ") }));
  return { nodes, edges };
}
