"use client";
import { apiV2Get, hasKnowledgeGraphSupport } from "./penelopa-client";
import type { GraphChunk, GraphRun, GraphRuns, GraphSnapshot } from "./knowledge-graph-types";

export type GraphListQuery = {
  project_id?: string; project_key?: string; session_id?: string; session_key?: string;
  external_session_id?: string; source?: string; current_only?: boolean; limit?: number; cursor?: string;
  created_after?: string; created_before?: string; finished_after?: string; finished_before?: string;
  transcript_after?: string; transcript_before?: string;
};
export type GraphChunkQuery = { node_limit?: number; edge_limit?: number; node_cursor?: string; edge_cursor?: string; node_query?: string; edge_query?: string; relationship?: string };
type Read = <T>(path: string, token: string, init: RequestInit) => Promise<T>;

// Bound HTTP and IPC together, including availability probes and catalog reads.
let active = 0;
const waiting: (() => void)[] = [];
async function bounded<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  if (active >= 3) await new Promise<void>(resolve => waiting.push(resolve));
  else active++;
  try { signal?.throwIfAborted(); const result = await operation(); signal?.throwIfAborted(); return result; }
  finally { const next = waiting.shift(); if (next) next(); else active--; }
}
function pathWithQuery(path: string, query: GraphListQuery | GraphChunkQuery) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => { if (value !== undefined && value !== "") params.set(key, String(value)); });
  return `${path}?${params}`;
}
export function createGraphClient(read: Read = apiV2Get) {
  const get = <T>(path: string, token: string, signal?: AbortSignal) => bounded(() => read<T>(path, token, { signal }), signal);
  return {
    list: (token: string, query: GraphListQuery = {}, signal?: AbortSignal) => get<GraphRuns>(pathWithQuery("/user-read/knowledge-graphs", query), token, signal),
    run: (token: string, id: string, query: GraphChunkQuery = {}, signal?: AbortSignal) => get<GraphChunk>(pathWithQuery(`/user-read/knowledge-graphs/${encodeURIComponent(id)}`, query), token, signal),
    session: (token: string, id: string, query: GraphChunkQuery = {}, signal?: AbortSignal) => get<GraphChunk>(pathWithQuery(`/user-read/sessions/${encodeURIComponent(id)}/knowledge-graph`, query), token, signal),
  };
}
export const graphClient = createGraphClient();
export function assertGraphSupport() {
  if (!hasKnowledgeGraphSupport()) throw Object.assign(new Error("Update & restart the app to explore knowledge graphs."), { status: 426, code: "desktop_update_required" });
}
function nextCursor(cursor: string | null, seen: Set<string>) {
  if (cursor && seen.has(cursor)) throw new Error("The graph cursor repeated. Refresh to restart loading.");
  if (cursor) seen.add(cursor);
  return cursor || undefined;
}
export async function graphAvailable(token: string, signal: AbortSignal, sessionId?: string, client = graphClient): Promise<boolean> {
  const seen = new Set<string>(); let cursor: string | undefined;
  do {
    const page = await client.list(token, { current_only: false, limit: 100, session_id: sessionId, cursor }, signal);
    if (page.items.some(run => run.node_count > 0)) return true;
    cursor = nextCursor(page.next_cursor, seen);
  } while (cursor);
  return false;
}
export async function graphCatalog(token: string, signal: AbortSignal, client = graphClient): Promise<GraphRun[]> {
  const runs = new Map<string, GraphRun>(), seen = new Set<string>(); let cursor: string | undefined;
  do {
    const page = await client.list(token, { current_only: false, limit: 100, cursor }, signal);
    for (const run of page.items) runs.set(run.id, run);
    cursor = nextCursor(page.next_cursor, seen);
  } while (cursor);
  return [...runs.values()];
}
type PartialRun = GraphSnapshot & { nodeCursor?: string; edgeCursor?: string; nodesDone: boolean; edgesDone: boolean; nodeCursors: Set<string>; edgeCursors: Set<string> };
// One instance per account/project. A retry resumes the last successfully received page.
export class GraphProjectLoader {
  private runs = new Map<string, PartialRun>();
  constructor(private client = graphClient) {}
  async load(token: string, runs: GraphRun[], signal: AbortSignal, progress: (done: number, total: number) => void): Promise<GraphSnapshot[]> {
    const selected = runs.filter(run => run.node_count > 0);
    const pending = selected.filter(run => { const state = this.runs.get(run.id); return !state?.nodesDone || !state.edgesDone; });
    let done = selected.length - pending.length;
    progress(done, selected.length);
    // Promise.allSettled keeps all workers drained before a retry can start.
    let failure: unknown;
    const workers = Array.from({ length: Math.min(3, pending.length) }, async () => {
      while (pending.length && !failure) {
        const run = pending.shift()!;
        try {
          let state = this.runs.get(run.id);
          if (!state) { state = { run, nodes: [], edges: [], nodesDone: false, edgesDone: false, nodeCursors: new Set(), edgeCursors: new Set() }; this.runs.set(run.id, state); }
          while (!state.nodesDone || !state.edgesDone) {
            signal.throwIfAborted();
            const page = await this.client.run(token, run.id, {
              node_limit: state.nodesDone ? 1 : 500, edge_limit: state.edgesDone ? 1 : 500,
              node_cursor: state.nodeCursor, edge_cursor: state.edgeCursor,
            }, signal);
            signal.throwIfAborted();
            // Validate both cursors before committing either stream.
            if (!state.nodesDone && page.node_next_cursor && state.nodeCursors.has(page.node_next_cursor) ||
                !state.edgesDone && page.edge_next_cursor && state.edgeCursors.has(page.edge_next_cursor)) throw new Error("The graph cursor repeated. Refresh to restart loading.");
            if (!state.nodesDone) { state.nodes.push(...page.nodes); state.nodeCursor = nextCursor(page.node_next_cursor, state.nodeCursors); state.nodesDone = !state.nodeCursor; }
            if (!state.edgesDone) { state.edges.push(...page.edges); state.edgeCursor = nextCursor(page.edge_next_cursor, state.edgeCursors); state.edgesDone = !state.edgeCursor; }
          }
          progress(++done, selected.length);
        } catch (error) { failure ??= error; }
      }
    });
    await Promise.allSettled(workers);
    signal.throwIfAborted();
    if (failure) throw failure;
    return selected.map(run => { const state = this.runs.get(run.id)!; return { run, nodes: state.nodes, edges: state.edges }; });
  }
}
