"use client";
import { useEffect, useState } from "react";
import { graphAvailable } from "../../lib/knowledge-graph-client";
import { hasKnowledgeGraphSupport, isDesktop, readStoredToken } from "../../lib/penelopa-client";

export function useGraphIdentity() {
  const [identity, setIdentity] = useState<{ token: string | null; generation: number }>({ token: null, generation: 0 });
  useEffect(() => {
    let disposed = false, revision = 0;
    async function refresh() {
      const current = ++revision;
      let token = readStoredToken();
      if (isDesktop()) {
        try { if (!(await window.penelopaDesktop!.auth.state()).authenticated) token = null; }
        catch { token = null; }
      }
      if (!disposed && current === revision) setIdentity(previous => previous.token === token ? previous : { token, generation: previous.generation + 1 });
    }
    const clear = () => { revision++; setIdentity(previous => ({ token: null, generation: previous.generation + 1 })); };
    void refresh();
    window.addEventListener("penelopa-auth-change", refresh); window.addEventListener("penelopa-auth-clear", clear);
    window.addEventListener("storage", refresh); window.addEventListener("focus", refresh);
    return () => { disposed = true; revision++; window.removeEventListener("penelopa-auth-change", refresh); window.removeEventListener("penelopa-auth-clear", clear); window.removeEventListener("storage", refresh); window.removeEventListener("focus", refresh); };
  }, []);
  return identity;
}
export function useGraphAvailability(token: string | null, sessionId?: string, generation = 0) {
  const key = `${generation}:${token}:${sessionId || ""}`;
  const [state, setState] = useState({ key: "", available: false });
  useEffect(() => {
    if (!token || !hasKnowledgeGraphSupport()) return;
    const controller = new AbortController(); let live = true;
    const check = () => {
      graphAvailable(token, controller.signal, sessionId).then(available => {
        if (live) setState({ key, available });
      }).catch(() => { /* Unknown is never interpreted as a confirmed empty account. */ });
    };
    check(); window.addEventListener("focus", check); window.addEventListener("penelopa-graphs-refresh", check);
    return () => { live = false; controller.abort(); window.removeEventListener("focus", check); window.removeEventListener("penelopa-graphs-refresh", check); };
  }, [token, sessionId, key]);
  return Boolean(token && state.key === key && state.available);
}
