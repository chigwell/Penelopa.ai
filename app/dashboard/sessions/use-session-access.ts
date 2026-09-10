"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiV2Get, clearStoredToken, consumeTokenFromHash, hasTranscriptSupport, isDesktop, readStoredToken, storeToken, type ApiError } from "../../lib/penelopa-client";

// Transient, account-scoped LRU. Transcripts never enter browser storage.
const resourceCache = new Map<string, unknown>();
let cacheOwner: string | null = null;
function remember(key: string, data: unknown) {
  resourceCache.delete(key); resourceCache.set(key, data);
  while (resourceCache.size > 12) resourceCache.delete(resourceCache.keys().next().value!);
}

export function useSessionAccess() {
  const [token, setToken] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [supported, setSupported] = useState(true);
  const [tokenInput, setTokenInput] = useState("");
  const [authError, setAuthError] = useState("");
  const pendingToken = useRef<string | null>(null);
  useEffect(() => {
    function initialize() {
      const hash = consumeTokenFromHash();
      const candidate = hash || readStoredToken();
      pendingToken.current = hash;
      setToken(candidate); setInitialized(true); setSupported(hasTranscriptSupport());
    }
    initialize();
    window.addEventListener("hashchange", initialize);
    const storage = (event: StorageEvent) => { if (event.key === "penelopa-api-token") initialize(); };
    const cleared = () => { pendingToken.current = null; resourceCache.clear(); cacheOwner = null; setToken(null); setTokenInput(""); };
    window.addEventListener("storage", storage);
    window.addEventListener("penelopa-auth-clear", cleared);
    return () => { window.removeEventListener("hashchange", initialize); window.removeEventListener("storage", storage); window.removeEventListener("penelopa-auth-clear", cleared); };
  }, []);
  const logout = useCallback(() => {
    pendingToken.current = null; resourceCache.clear(); cacheOwner = null; clearStoredToken(); setToken(null); setTokenInput(""); setAuthError("");
  }, []);
  const onError = useCallback((error: ApiError) => {
    if (error.status === 401) { logout(); setAuthError("Your access token has expired. Enter it again."); }
  }, [logout]);
  const verified = useCallback((candidate: string) => {
    if (pendingToken.current === candidate) { storeToken(candidate); pendingToken.current = null; }
  }, []);
  function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const candidate = tokenInput.trim();
    if (!candidate) { setAuthError("Enter your access token to continue."); return; }
    pendingToken.current = candidate; setAuthError(""); setToken(candidate);
  }
  return { token, initialized, supported, tokenInput, setTokenInput, authError, logout, onError, verified, signIn };
}

export function useTranscriptResource<T>(path: string | null, token: string | null, onError?: (error: ApiError) => void) {
  const [revision, setRevision] = useState(0);
  const key = `${token || ""}\n${path || ""}`;
  const currentKey = useRef(key); currentKey.current = key;
  const [state, setState] = useState<{ key: string; data: T | null; error: ApiError | null; loading: boolean }>({ key: "", data: null, error: null, loading: false });
  const reload = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    if (!path || !token) return;
    const cacheable = !isDesktop();
    if (!cacheable || cacheOwner !== token) { resourceCache.clear(); cacheOwner = cacheable ? token : null; }
    const controller = new AbortController();
    let active = true;
    setState(previous => ({ key, data: previous.key === key ? previous.data : resourceCache.get(key) as T || null, error: null, loading: true }));
    apiV2Get<T>(path, token, { signal: controller.signal }).then(data => {
      if (active && currentKey.current === key) { if (cacheable) remember(key, data); setState({ key, data, error: null, loading: false }); }
    }).catch((error: ApiError) => {
      if (active && currentKey.current === key) { setState(previous => ({ key, data: previous.key === key ? previous.data : null, error, loading: false })); onError?.(error); }
    });
    return () => { active = false; controller.abort(); };
  }, [path, token, key, revision, onError]);
  return { data: state.key === key ? state.data : null, error: state.key === key ? state.error : null, loading: Boolean(path && token && (state.key !== key || state.loading)), reload };
}
