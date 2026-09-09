"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiV2Get, type ApiError } from "../../lib/penelopa-client";
import type { EventTail } from "../../lib/transcript-types";
import { mergeEvents, queryPath } from "../../lib/transcript-display";

type TailState = { data: EventTail | null; error: ApiError | null; newCount: number; resetCount: number; paused: boolean };
const emptyState = (): TailState => ({ data: null, error: null, newCount: 0, resetCount: 0, paused: false });

function sameTail(previous: EventTail | null, next: EventTail) {
  return previous !== null && previous.tail_cursor === next.tail_cursor &&
    previous.history_cursor === next.history_cursor && previous.has_more === next.has_more &&
    previous.reset_required === next.reset_required && previous.analysis_run_id === next.analysis_run_id &&
    previous.analysis_watermark_decimal === next.analysis_watermark_decimal &&
    previous.latest_event_seq_decimal === next.latest_event_seq_decimal &&
    (previous.items === next.items || JSON.stringify(previous.items) === JSON.stringify(next.items));
}

// The controller owns one network operation at a time, including explicit latest-window reads.
// Exported separately from React so ordering, visibility and account disposal can be tested.
export function createTailController({ request, isVisible, publish, onError }: {
  request: (cursor: string, signal: AbortSignal) => Promise<EventTail>;
  isVisible: () => boolean;
  publish: (state: TailState) => void;
  onError: (error: ApiError) => void;
}) {
  let state = emptyState();
  let active = true, busy = false, stopped = false, cursor = "", failures = 0;
  let bootstrapInFlight = false, bootstrapPending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | null = null;
  const bootstrapWaiters: Array<(data: EventTail | null) => void> = [];
  const seen = new Set<string>();
  const emit = (patch: Partial<TailState>) => { if (active) { state = { ...state, ...patch }; publish(state); } };
  const clearTimer = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  const resolveBootstraps = (data: EventTail | null) => { bootstrapWaiters.splice(0).forEach(resolve => resolve(data)); };

  async function poll(forceBootstrap = false) {
    if (!active || busy || stopped && !forceBootstrap) return;
    if (!isVisible()) { emit({ paused: true }); if (forceBootstrap) resolveBootstraps(null); return; }
    busy = true;
    bootstrapInFlight = forceBootstrap || !cursor;
    controller = new AbortController();
    let delay = 3000;
    try {
      const response = await request(bootstrapInFlight ? "" : cursor, controller.signal);
      if (!active) return;
      failures = 0;
      if (response.reset_required) {
        cursor = ""; seen.clear(); bootstrapPending = true;
        emit({ data: null, resetCount: state.resetCount + 1, newCount: 0, error: null, paused: false });
      } else {
        let added = 0;
        if (bootstrapInFlight) seen.clear();
        response.items.forEach(event => { if (!bootstrapInFlight && !seen.has(event.id)) added++; seen.add(event.id); });
        while (seen.size > 1000) seen.delete(seen.values().next().value!);
        const items = !bootstrapInFlight && !response.items.length && state.data
          ? state.data.items : mergeEvents(bootstrapInFlight ? [] : state.data?.items || [], response.items);
        // Every server reply anchors history to this rolling window's delivered activation frontier.
        // A null cursor means there are no older events, and must clear any previous anchor.
        const candidate: EventTail = { ...response, items, history_cursor: response.history_cursor };
        const data = sameTail(state.data, candidate) ? state.data! : candidate;
        cursor = response.tail_cursor;
        emit({ data, error: null, newCount: bootstrapInFlight ? 0 : state.newCount + added, paused: false });
        if (bootstrapInFlight) resolveBootstraps(data);
        if (response.has_more) delay = 0;
      }
    } catch (caught) {
      if (!active) return;
      const error = caught as ApiError;
      emit({ error }); onError(error);
      if ([401, 403, 404, 410].includes(error.status)) stopped = true;
      if (bootstrapInFlight) resolveBootstraps(null);
      delay = Math.min(30000, 3000 * 2 ** ++failures);
    } finally {
      busy = false; bootstrapInFlight = false;
      if (!active) return;
      if (stopped) { bootstrapPending = false; resolveBootstraps(null); return; }
      if (bootstrapPending) {
        bootstrapPending = false;
        void poll(true);
      } else if (!stopped && isVisible()) {
        clearTimer(); timer = setTimeout(() => void poll(), delay);
      }
    }
  }

  function refreshBootstrap(): Promise<EventTail | null> {
    if (!active) return Promise.resolve(null);
    clearTimer(); stopped = false;
    const promise = new Promise<EventTail | null>(resolve => bootstrapWaiters.push(resolve));
    if (busy) { if (!bootstrapInFlight) bootstrapPending = true; }
    else void poll(true);
    return promise;
  }
  return {
    refreshBootstrap,
    refresh() { clearTimer(); void poll(); },
    visibilityChanged() { clearTimer(); if (isVisible()) void poll(); else emit({ paused: true }); },
    acknowledge() { if (state.newCount) emit({ newCount: 0 }); },
    stop() { active = false; clearTimer(); controller?.abort(); resolveBootstraps(null); },
  };
}

export function useLiveEvents(sessionId: string, token: string | null, enabled: boolean, onError: (error: ApiError) => void) {
  const key = `${token || ""}:${sessionId}`;
  const [state, setState] = useState<TailState & { key: string }>({ key: "", ...emptyState() });
  const scope = `${key}:${enabled}`;
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const activeController = useRef<{ scope: string; follower: ReturnType<typeof createTailController> } | null>(null);
  const acknowledge = useCallback(() => { const instance = activeController.current; if (instance?.scope === scopeRef.current) instance.follower.acknowledge(); }, []);
  const refresh = useCallback(() => { const instance = activeController.current; if (instance?.scope === scopeRef.current) instance.follower.refresh(); }, []);
  const refreshBootstrap = useCallback(async () => {
    const instance = activeController.current;
    if (!instance || instance.scope !== scopeRef.current) return null;
    const data = await instance.follower.refreshBootstrap();
    return instance === activeController.current && instance.scope === scopeRef.current ? data : null;
  }, []);
  useEffect(() => {
    if (!token || !enabled) return;
    setState({ key, ...emptyState() });
    const follower = createTailController({
      request: (cursor, signal) => apiV2Get<EventTail>(queryPath(`/user-read/sessions/${encodeURIComponent(sessionId)}/events/tail`, { cursor, limit: 100 }), token, { signal }),
      isVisible: () => !document.hidden && navigator.onLine,
      publish: value => { if (scopeRef.current === scope) setState({ key, ...value }); },
      onError: error => { if (scopeRef.current === scope) onError(error); },
    });
    const instance = { scope, follower };
    activeController.current = instance;
    document.addEventListener("visibilitychange", follower.visibilityChanged);
    window.addEventListener("online", follower.visibilityChanged);
    window.addEventListener("offline", follower.visibilityChanged);
    window.addEventListener("focus", follower.refresh);
    follower.refresh();
    return () => {
      follower.stop();
      if (activeController.current === instance) activeController.current = null;
      document.removeEventListener("visibilitychange", follower.visibilityChanged);
      window.removeEventListener("online", follower.visibilityChanged);
      window.removeEventListener("offline", follower.visibilityChanged);
      window.removeEventListener("focus", follower.refresh);
    };
  }, [sessionId, token, enabled, key, scope, onError]);
  return { ...(enabled && state.key === key ? state : emptyState()), acknowledge, refresh, refreshBootstrap };
}
