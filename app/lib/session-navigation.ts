import { queryPath } from "./transcript-display";

type QueryParameters = { get: (name: string) => string | null };

export type SessionLocation = {
  cursor: string;
  direction: string;
  at: string;
};

type EventFilters = {
  query: string;
  actor: string;
  kind: string;
  status: string;
  tool: string;
};

export type SessionDetailQuery = EventFilters & {
  view: "events" | "process";
  eventId: string;
  sectionId: string;
  stepId: string;
  cursor: string;
  direction: string;
  atLatest: boolean;
};

export function readSessionDetailQuery(
  params: QueryParameters,
): SessionDetailQuery {
  return {
    view: params.get("view") === "process" ? "process" : "events",
    eventId: params.get("event") || "",
    sectionId: params.get("section") || "",
    stepId: params.get("step") || "",
    cursor: params.get("cursor") || "",
    direction: params.get("direction") || "forward",
    atLatest: params.get("at") === "latest",
    query: params.get("q") || "",
    actor: params.get("actor") || "",
    kind: params.get("kind") || "",
    status: params.get("status") || "",
    tool: params.get("tool") || "",
  };
}

export function readSessionLibraryQuery(params: QueryParameters) {
  return {
    cursor: params.get("cursor") || "",
    project: params.get("project") || "",
    source: params.get("source") || "",
    period: params.get("period") || "",
  };
}

export function sessionEventsPath(
  id: string,
  {
    query,
    cursor,
    direction,
    actor,
    kind,
    status,
    tool,
  }: EventFilters & Pick<SessionLocation, "cursor" | "direction">,
) {
  return query
    ? queryPath("/process/events/search", {
        session_id: id,
        query,
        cursor,
        limit: 50,
        kind,
        tool,
        status,
      })
    : queryPath(`/user-read/sessions/${encodeURIComponent(id)}/events`, {
        limit: 100,
        cursor,
        direction,
        actor,
        kind,
        status,
        tool,
        max_chars: 30000,
      });
}

export function sessionTimelinePath(id: string, afterStep: string | null) {
  return queryPath(`/process/sessions/${encodeURIComponent(id)}/timeline`, {
    limit: 100,
    after_step: afterStep,
  });
}

export function sessionCatalogPath({
  cursor,
  project,
  source,
  lastSeenAfter,
}: {
  cursor: string;
  project: string;
  source: string;
  lastSeenAfter: string;
}) {
  return queryPath("/user-read/sessions", {
    limit: 25,
    cursor,
    project_key: project,
    source,
    last_seen_after: lastSeenAfter,
  });
}

function updatedQuery(
  search: string,
  values: Record<string, string>,
  resetCursor = false,
) {
  const next = new URLSearchParams(search);
  if (resetCursor) next.delete("cursor");
  Object.entries(values).forEach(([key, value]) =>
    value ? next.set(key, value) : next.delete(key),
  );
  return next.size ? `?${next}` : "";
}

export function sessionDetailHref(
  id: string,
  search: string,
  values: Record<string, string>,
) {
  return `/dashboard/sessions/${encodeURIComponent(id)}${updatedQuery(search, values)}`;
}

export function sessionLibraryHref(
  search: string,
  values: Record<string, string>,
  resetCursor = true,
) {
  return `/dashboard/sessions${updatedQuery(search, values, resetCursor)}`;
}

export function sessionLocationKey(
  { query, actor, kind, status, tool }: EventFilters,
  location: SessionLocation,
) {
  return `${query}|${actor}|${kind}|${status}|${tool}|${location.direction}|${location.cursor}|${location.at}`;
}
