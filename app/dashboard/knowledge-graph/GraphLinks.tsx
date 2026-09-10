"use client";
import Link from "next/link";
import { useGraphAvailability, useGraphIdentity } from "./use-graph-availability";
export function GraphNavigation({ active }: { active: boolean }) {
  const identity = useGraphIdentity();
  const available = useGraphAvailability(identity.token, undefined, identity.generation);
  return available ? <Link href="/dashboard/knowledge-graph" aria-current={active ? "page" : undefined}>Knowledge Graph</Link> : null;
}
export function SessionGraphLink({ token, project, session }: { token: string | null; project: string; session: string }) {
  const available = useGraphAvailability(token, session);
  return available ? <Link className="session-text-link" href={`/dashboard/knowledge-graph?${new URLSearchParams({ project, session })}`}>Knowledge Graph ↗</Link> : null;
}
