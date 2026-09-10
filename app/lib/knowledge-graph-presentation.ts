import { UndirectedGraph } from "graphology";
import louvain from "graphology-communities-louvain";
import type { GraphColor, GraphCommunity, GraphPresentation, PresentationRequest } from "./knowledge-graph-types";

// Paired hues retain their identity when the canvas changes theme.
export const communityColors: GraphColor[] = [
  { light: "#2459c4", dark: "#70acff" }, { light: "#af2777", dark: "#ff83c0" },
  { light: "#007e70", dark: "#47d9bd" }, { light: "#b95015", dark: "#ffa65c" },
  { light: "#7440bd", dark: "#bd98ff" }, { light: "#9c6810", dark: "#f0cb57" },
  { light: "#bd3444", dark: "#ff8290" }, { light: "#177792", dark: "#65d0ef" },
  { light: "#52752a", dark: "#aad976" }, { light: "#654cbd", dark: "#a9a0ff" },
];
export const isolatedColor: GraphColor = { light: "#777169", dark: "#aaa397" };
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export function prepareGraphPresentation({ nodes, edges }: Pick<PresentationRequest, "nodes" | "edges">): GraphPresentation {
  const ordered = [...nodes].sort((a, b) => compare(a.id, b.id));
  const degrees = new Map(ordered.map(node => [node.id, 0]));
  const graph = new UndirectedGraph({ allowSelfLoops: true });
  for (const node of ordered) graph.addNode(node.id);
  // Directed relationships remain distinct in degree, but contribute weight to one undirected pair.
  for (const edge of [...edges].sort((a, b) => compare(a.id, b.id))) {
    if (!degrees.has(edge.source) || !degrees.has(edge.target)) continue;
    degrees.set(edge.source, degrees.get(edge.source)! + 1);
    degrees.set(edge.target, degrees.get(edge.target)! + 1); // A self-loop contributes one in + one out.
    const [source, target] = [edge.source, edge.target].sort(compare);
    const key = JSON.stringify([source, target]);
    if (graph.hasEdge(key)) graph.updateEdgeAttribute(key, "weight", weight => weight + 1);
    else graph.addEdgeWithKey(key, source, target, { weight: 1 });
  }
  const partition = graph.size ? louvain(graph, { randomWalk: false, resolution: 1, getEdgeWeight: "weight" }) : {};
  const groups = new Map<number, typeof ordered>();
  for (const node of ordered) {
    if (!degrees.get(node.id)) continue;
    const key = partition[node.id];
    const members = groups.get(key) || []; members.push(node); groups.set(key, members);
  }
  const membership = new Map<string, GraphCommunity>();
  const communities = [...groups.values()].sort((a, b) => compare(a[0].id, b[0].id)).map((members, index) => {
    const leader = [...members].sort((a, b) => degrees.get(b.id)! - degrees.get(a.id)! || compare(a.id, b.id))[0];
    const community = { id: members[0].id, label: `Around ${leader.label}`, count: members.length, color: communityColors[index % communityColors.length] };
    for (const node of members) membership.set(node.id, community);
    return community;
  }).sort((a, b) => b.count - a.count || compare(a.id, b.id));
  return {
    nodes: ordered.map(node => {
      const community = membership.get(node.id);
      return { ...node, degree: degrees.get(node.id)!, communityId: community?.id ?? null, communityLabel: community?.label ?? "Unconnected", color: community?.color ?? isolatedColor };
    }),
    communities,
    isolatedCount: ordered.length - membership.size,
  };
}
