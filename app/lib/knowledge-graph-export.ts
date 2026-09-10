"use client";

import type { GraphOrigin, GraphSelection, KnowledgeEdge, KnowledgeNode } from "./knowledge-graph-types";

export const KNOWLEDGE_GRAPH_CSV_NAME = "knowledge-graph-relationships.csv";
export const KNOWLEDGE_GRAPH_README_NAME = "README.md";

const CSV_COLUMNS = [
  "edge_id",
  "origin_index",
  "source_entity_id",
  "source_entity_label",
  "source_origin_ids",
  "source_origin_labels",
  "relationship",
  "relationship_origin_id",
  "target_entity_id",
  "target_entity_label",
  "target_origin_ids",
  "target_origin_labels",
  "observed_at",
  "run_id",
  "project_id",
  "project_key",
  "session_id",
  "session_key",
  "source",
  "transcript_first_seen_at",
  "transcript_last_seen_at",
] as const;

export type KnowledgeGraphExportFilter = {
  project: { id: string; label: string };
  source: { value: string; label: string };
  sessions: { id: string; label: string }[];
  relationship: string;
  edgeQuery: string;
  entityQuery: string;
  currentUrl?: string;
};

export type KnowledgeGraphExportInput = KnowledgeGraphExportFilter & {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  selection: GraphSelection;
  skipped: number;
  generatedAt?: Date;
};

export type KnowledgeGraphExport = {
  filename: string;
  bytes: Uint8Array;
  csv: string;
  readme: string;
};

type ExportStats = {
  visibleEntities: number;
  visibleRelationships: number;
  connectedEntities: number;
  omittedIsolatedEntities: number;
  relationshipOrigins: number;
};

type RelationshipRow = {
  edge: KnowledgeEdge;
  origin: GraphOrigin;
  originIndex: number;
  source: KnowledgeNode;
  target: KnowledgeNode;
};

function iso(at: number) {
  return Number.isFinite(at) ? new Date(at).toISOString() : "";
}

function selectionLabel(selection: GraphSelection) {
  if (selection.mode === "all") return "All time";
  if (selection.mode === "latest") return `Latest (${iso(selection.at)})`;
  return `Range (${iso(Math.min(selection.from, selection.to))} to ${iso(Math.max(selection.from, selection.to))})`;
}

function unique(values: (string | null | undefined)[]) {
  return [...new Set(values.filter((value): value is string => !!value))];
}

function jsonList(values: string[]) {
  return JSON.stringify(values);
}

function matchingOrigins(node: KnowledgeNode, origin: GraphOrigin) {
  const matches = node.origins.filter(item =>
    item.runId === origin.runId &&
    item.projectId === origin.projectId &&
    item.sessionId === origin.sessionId &&
    item.source === origin.source &&
    item.at === origin.at
  );
  return matches.length ? matches : node.origins;
}

function connectedNodeIds(edges: KnowledgeEdge[]) {
  const ids = new Set<string>();
  for (const edge of edges) {
    ids.add(edge.source);
    ids.add(edge.target);
  }
  return ids;
}

function relationshipRows(input: Pick<KnowledgeGraphExportInput, "nodes" | "edges">): RelationshipRow[] {
  const nodesById = new Map(input.nodes.map(node => [node.id, node]));
  const rows: RelationshipRow[] = [];
  for (const edge of input.edges) {
    const source = nodesById.get(edge.source), target = nodesById.get(edge.target);
    if (!source || !target) continue;
    edge.origins.forEach((origin, index) => rows.push({ edge, origin, originIndex: index + 1, source, target }));
  }
  return rows;
}

function exportStats(input: Pick<KnowledgeGraphExportInput, "nodes" | "edges">): ExportStats {
  const connected = connectedNodeIds(input.edges);
  return {
    visibleEntities: input.nodes.length,
    visibleRelationships: input.edges.length,
    connectedEntities: input.nodes.filter(node => connected.has(node.id)).length,
    omittedIsolatedEntities: input.nodes.filter(node => !connected.has(node.id)).length,
    relationshipOrigins: relationshipRows(input).length,
  };
}

function protectSpreadsheetCell(value: string) {
  const visibleStart = value.trimStart();
  if (/^[=+\-@]/.test(visibleStart) || /^[\t\r]/.test(value)) return `'${value}`;
  return value;
}

function csvCell(value: string | number | null | undefined) {
  const safe = protectSpreadsheetCell(String(value ?? ""));
  return `"${safe.replace(/"/g, `""`)}"`;
}

function csvRow(values: (string | number | null | undefined)[]) {
  return values.map(csvCell).join(",");
}

export function buildKnowledgeGraphRelationshipsCsv(input: Pick<KnowledgeGraphExportInput, "nodes" | "edges">) {
  const rows = relationshipRows(input).map(({ edge, origin, originIndex, source, target }) => {
    const sourceOrigins = matchingOrigins(source, origin), targetOrigins = matchingOrigins(target, origin);
    return [
      edge.id,
      originIndex,
      source.id,
      source.label,
      jsonList(unique(sourceOrigins.map(item => item.originalId))),
      jsonList(unique(sourceOrigins.map(item => item.label))),
      origin.label || edge.relationship,
      origin.originalId,
      target.id,
      target.label,
      jsonList(unique(targetOrigins.map(item => item.originalId))),
      jsonList(unique(targetOrigins.map(item => item.label))),
      iso(origin.at),
      origin.runId,
      origin.projectId,
      origin.projectKey,
      origin.sessionId,
      origin.sessionKey,
      origin.source,
      origin.transcriptStart,
      origin.transcriptEnd,
    ];
  });
  return [csvRow([...CSV_COLUMNS]), ...rows.map(csvRow)].join("\r\n") + "\r\n";
}

export function buildKnowledgeGraphReadme(input: KnowledgeGraphExportInput, generatedAt: Date, stats: ExportStats) {
  const sessionLines = input.sessions.length
    ? input.sessions.map(session => `- ${session.label} (${session.id})`).join("\n")
    : "- All sessions";
  const columnLines = CSV_COLUMNS.map(column => `- \`${column}\``).join("\n");
  return `# Knowledge Graph Export

Generated at: ${generatedAt.toISOString()}
Current URL: ${input.currentUrl || "Not recorded"}

## Active View

Project: ${input.project.label} (${input.project.id})
Source: ${input.source.label}${input.source.value ? ` (${input.source.value})` : ""}
Sessions:
${sessionLines}
Timeline: ${selectionLabel(input.selection)}
Relationship filter: ${input.relationship || "All relationships"}
Connection search: ${input.edgeQuery || "None"}
Entity search: ${input.entityQuery ? `${input.entityQuery} (highlight only; not applied to CSV rows)` : "None"}

## Counts

Visible entities: ${stats.visibleEntities}
Connected entities exported: ${stats.connectedEntities}
Omitted isolated entities: ${stats.omittedIsolatedEntities}
Visible relationships: ${stats.visibleRelationships}
Relationship origins exported: ${stats.relationshipOrigins}
Invalid elements skipped while preparing graph: ${input.skipped}

## Files

- \`${KNOWLEDGE_GRAPH_CSV_NAME}\`: relationship-origin CSV for connected entities in the active view.

## CSV Columns

${columnLines}
`;
}

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function encodeText(value: string) {
  return new TextEncoder().encode(value);
}

function write16(bytes: Uint8Array, offset: number, value: number) {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint16(offset, value, true);
}

function write32(bytes: Uint8Array, offset: number, value: number) {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value >>> 0, true);
}

function concat(chunks: Uint8Array[]) {
  const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function assertSafeZipName(name: string) {
  if (!name || name.startsWith("/") || /[\\:\0]/.test(name) || name.split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error("Unsafe ZIP entry name.");
  }
}

export function createStoreZip(entries: { name: string; contents: string | Uint8Array }[]) {
  const prepared = entries.map(entry => {
    assertSafeZipName(entry.name);
    return {
      name: entry.name,
      filename: encodeText(entry.name),
      data: typeof entry.contents === "string" ? encodeText(entry.contents) : entry.contents,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const seen = new Set<string>();
  const records: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of prepared) {
    const key = entry.name.toLowerCase();
    if (seen.has(key)) throw new Error("Duplicate ZIP entry name.");
    seen.add(key);
    if (entry.filename.length > 0xffff || entry.data.length > 0xffffffff) throw new Error("ZIP entry is too large.");
    const checksum = crc32(entry.data);
    const header = new Uint8Array(30);
    write32(header, 0, 0x04034b50); write16(header, 4, 20); write16(header, 6, 0x800); write16(header, 8, 0);
    write16(header, 12, 33); write32(header, 14, checksum); write32(header, 18, entry.data.length); write32(header, 22, entry.data.length); write16(header, 26, entry.filename.length);
    const directory = new Uint8Array(46);
    write32(directory, 0, 0x02014b50); write16(directory, 4, 20); write16(directory, 6, 20); write16(directory, 8, 0x800); write16(directory, 10, 0);
    write16(directory, 14, 33); write32(directory, 16, checksum); write32(directory, 20, entry.data.length); write32(directory, 24, entry.data.length); write16(directory, 28, entry.filename.length); write32(directory, 42, offset);
    records.push(header, entry.filename, entry.data);
    central.push(directory, entry.filename);
    offset += header.length + entry.filename.length + entry.data.length;
  }
  const directory = concat(central);
  const end = new Uint8Array(22);
  write32(end, 0, 0x06054b50); write16(end, 8, prepared.length); write16(end, 10, prepared.length); write32(end, 12, directory.length); write32(end, 16, offset);
  return concat([...records, directory, end]);
}

function exportFilename(generatedAt: Date) {
  return `knowledge-graph-current-view-${generatedAt.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "")}.zip`;
}

export function buildKnowledgeGraphExport(input: KnowledgeGraphExportInput): KnowledgeGraphExport {
  const generatedAt = input.generatedAt || new Date();
  const stats = exportStats(input);
  const csv = buildKnowledgeGraphRelationshipsCsv(input);
  const readme = buildKnowledgeGraphReadme(input, generatedAt, stats);
  const bytes = createStoreZip([
    { name: KNOWLEDGE_GRAPH_CSV_NAME, contents: csv },
    { name: KNOWLEDGE_GRAPH_README_NAME, contents: readme },
  ]);
  return { filename: exportFilename(generatedAt), bytes, csv, readme };
}

export function downloadKnowledgeGraphExport(input: KnowledgeGraphExportInput) {
  const output = buildKnowledgeGraphExport(input);
  const buffer = new ArrayBuffer(output.bytes.byteLength);
  new Uint8Array(buffer).set(output.bytes);
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/zip" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = output.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return output;
}
