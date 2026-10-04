"use client";

import { useEffect, useRef, useState } from "react";
import type { useRouter, useSearchParams } from "next/navigation";
import type {
  CursorPage,
  EventTail,
  ProcessTimeline,
  TranscriptEvent,
  TranscriptSession,
} from "../../lib/transcript-types";
import {
  readSessionDetailQuery,
  sessionDetailHref,
  sessionEventsPath,
  sessionLocationKey,
  sessionTimelinePath,
  type SessionLocation,
} from "../../lib/session-navigation";
import { useTranscriptResource } from "./use-session-access";
import type { useSessionAccess } from "./use-session-access";
import { useLiveEvents } from "./use-live-events";

type SessionWorkspaceOptions = {
  id: string;
  params: ReturnType<typeof useSearchParams>;
  router: ReturnType<typeof useRouter>;
  access: ReturnType<typeof useSessionAccess>;
};

export function useSessionWorkspace({
  id,
  params,
  router,
  access,
}: SessionWorkspaceOptions) {
  const routeQuery = readSessionDetailQuery(params);
  const {
    view,
    eventId,
    sectionId,
    stepId,
    cursor,
    direction,
    atLatest,
    query,
    actor,
    kind,
    status,
    tool,
  } = routeQuery;
  const [searchInput, setSearchInput] = useState(query);
  const [follow, setFollow] = useState(false);
  const [latestLoading, setLatestLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const history = useRef(new Map<string, SessionLocation>());
  const [snapshot, setSnapshot] = useState<{
    key: string;
    data: EventTail;
  } | null>(null);
  const snapshotKey = `${access.token || ""}:${id}`;
  const locationKey = (location: SessionLocation) =>
    sessionLocationKey(routeQuery, location);
  const currentLocation = { cursor, direction, at: atLatest ? "latest" : "" };
  const bottom = useRef<HTMLDivElement>(null);
  const timelineTop = useRef<HTMLDivElement>(null);
  const lastRun = useRef<string | null | undefined>(undefined);
  const lastReset = useRef(0);
  const session = useTranscriptResource<TranscriptSession>(
    access.supported && id
      ? `/user-read/sessions/${encodeURIComponent(id)}`
      : null,
    access.token,
    access.onError,
  );
  const live = useLiveEvents(
    id,
    access.token,
    access.supported && session.data?.storage_state === "HOT",
    access.onError,
  );
  const eventsPath = sessionEventsPath(id, routeQuery);
  const events = useTranscriptResource<CursorPage<TranscriptEvent>>(
    access.supported &&
      view === "events" &&
      !atLatest &&
      session.data?.storage_state === "HOT"
      ? eventsPath
      : null,
    access.token,
    access.onError,
  );
  const timeline = useTranscriptResource<ProcessTimeline>(
    access.supported && view === "process" && session.data
      ? sessionTimelinePath(id, params.get("after_step"))
      : null,
    access.token,
    access.onError,
  );
  const processHistory = useRef(new Map<string, string>());
  useEffect(() => {
    if (session.data && access.token) access.verified(access.token);
  }, [session.data, access.token, access.verified]);
  useEffect(() => {
    setSearchInput(query);
  }, [query]);
  const paramsRef = useRef(params.toString());
  paramsRef.current = params.toString();
  function update(values: Record<string, string>, replace = false) {
    const href = sessionDetailHref(id, paramsRef.current, values);
    if (replace) router.replace(href, { scroll: false });
    else router.push(href, { scroll: false });
  }
  useEffect(() => {
    if (searchInput === query) return;
    const timer = setTimeout(() => {
      history.current.clear();
      setFollow(false);
      update(
        { q: searchInput.trim(), cursor: "", at: "", direction: "", actor: "" },
        true,
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput, query]);
  useEffect(() => {
    if (!live.data) return;
    if (
      lastRun.current !== undefined &&
      lastRun.current !== live.data.analysis_run_id
    ) {
      processHistory.current.clear();
      update({ after_step: "", step: "" }, true);
      timeline.reload();
      session.reload();
      setNotice("A newer process overview is available.");
    }
    lastRun.current = live.data.analysis_run_id;
  }, [live.data?.analysis_run_id]);
  useEffect(() => {
    if (live.resetCount > lastReset.current) {
      lastReset.current = live.resetCount;
      setSnapshot(null);
      history.current.clear();
      update({ cursor: "", direction: "" }, true);
      events.reload();
      session.reload();
      setNotice("The transcript was updated after a new parse.");
    }
  }, [live.resetCount]);
  useEffect(() => {
    if (atLatest && live.data && (follow || snapshot?.key !== snapshotKey)) {
      setSnapshot({ key: snapshotKey, data: live.data });
      if (follow) live.acknowledge();
    }
  }, [atLatest, follow, live.data, snapshot?.key, snapshotKey]);
  useEffect(() => {
    if (follow && atLatest && snapshot?.key === snapshotKey)
      bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [follow, atLatest, snapshot, snapshotKey]);
  useEffect(() => {
    const stop = (event: WheelEvent) => {
      if (event.deltaY < -3) setFollow(false);
    };
    const touch = () => setFollow(false);
    const keyboard = (event: KeyboardEvent) => {
      if (
        ["PageUp", "Home", "ArrowUp"].includes(event.key) &&
        !(
          event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLTextAreaElement
        )
      )
        setFollow(false);
    };
    window.addEventListener("keydown", keyboard);
    window.addEventListener("wheel", stop, { passive: true });
    window.addEventListener("touchstart", touch, { passive: true });
    return () => {
      window.removeEventListener("keydown", keyboard);
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", touch);
    };
  }, []);
  function filter(values: Record<string, string>) {
    history.current.clear();
    setFollow(false);
    update({
      ...values,
      cursor: "",
      direction: "",
      at: "",
      event: "",
      section: "",
      step: "",
    });
  }
  function openEvent(event: string, section = "") {
    setFollow(false);
    update({ event, section, step: "" });
  }
  async function latest(enableFollow = false) {
    if (latestLoading) return;
    setLatestLoading(true);
    const fresh = await live.refreshBootstrap();
    setLatestLoading(false);
    if (!fresh) return;
    setSnapshot({ key: snapshotKey, data: fresh });
    setFollow(enableFollow);
    live.acknowledge();
    update({
      at: "latest",
      view: "events",
      cursor: "",
      direction: "",
      q: "",
      actor: "",
      kind: "",
      status: "",
      tool: "",
      event: "",
      section: "",
      step: "",
    });
  }
  function move(next: SessionLocation, pop = false) {
    if (!pop) history.current.set(locationKey(next), currentLocation);
    setFollow(false);
    update({ ...next, event: "", section: "" });
    timelineTop.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const displayedTail = snapshot?.key === snapshotKey ? snapshot.data : null;
  const rows = atLatest ? displayedTail?.items : events.data?.items;
  const eventLoading = atLatest
    ? !displayedTail && !live.error
    : events.loading;
  const currentStep = timeline.data?.steps.find((step) => step.id === stepId);
  const selected = Boolean(eventId || stepId);
  const sessionData = session.data;
  const eventError = atLatest ? live.error : events.error;
  const prior = atLatest
    ? displayedTail?.history_cursor
      ? () =>
          move({
            cursor: displayedTail.history_cursor!,
            direction: "backward",
            at: "",
          })
      : undefined
    : direction === "backward" && !query
      ? events.data?.next_cursor
        ? () =>
            move({
              cursor: events.data!.next_cursor!,
              direction: "backward",
              at: "",
            })
        : undefined
      : cursor
        ? () =>
            move(
              history.current.get(locationKey(currentLocation)) || {
                cursor: "",
                direction: "forward",
                at: "",
              },
              true,
            )
        : undefined;
  const next = atLatest
    ? undefined
    : direction === "backward" && !query
      ? () =>
          move(
            history.current.get(locationKey(currentLocation)) || {
              cursor: "",
              direction: "",
              at: "latest",
            },
            true,
          )
      : events.data?.next_cursor
        ? () =>
            move({
              cursor: events.data!.next_cursor!,
              direction: "forward",
              at: "",
            })
        : undefined;
  return {
    view,
    eventId,
    sectionId,
    stepId,
    atLatest,
    query,
    actor,
    kind,
    status,
    tool,
    searchInput,
    setSearchInput,
    follow,
    setFollow,
    latestLoading,
    notice,
    setNotice,
    bottom,
    timelineTop,
    session,
    live,
    events,
    timeline,
    processHistory,
    update,
    filter,
    openEvent,
    latest,
    rows,
    eventLoading,
    currentStep,
    selected,
    sessionData,
    eventError,
    prior,
    next,
  };
}
