"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, clearStoredToken, storeToken, readStoredToken, consumeTokenFromHash, type ApiError } from "../lib/penelopa-client";
import type { DashboardSummary, DailyActivityPoint, RecommendationPage, DashboardData } from "../lib/api-types";

type ScreenState = "locked" | "loading" | "ready" | "error";
const RECOMMENDATIONS_PAGE_SIZE = 10;

export function useDashboardData() {
  const [screen, setScreen] = useState<ScreenState>("loading");
  const [tokenInput, setTokenInput] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [pageLoading, setPageLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const activeToken = useRef<string | null>(null);
  const currentDashboard = useRef<DashboardData | null>(null);
  const loadVersion = useRef(0);
  const pageVersion = useRef(0);
  const loadController = useRef<AbortController | null>(null);
  const pageController = useRef<AbortController | null>(null);

  const cancelRequests = useCallback(() => {
    loadVersion.current += 1;
    pageVersion.current += 1;
    loadController.current?.abort();
    pageController.current?.abort();
  }, []);

  const lockDashboard = useCallback((message: string) => {
    cancelRequests();
    clearStoredToken();
    activeToken.current = null;
    currentDashboard.current = null;
    setToken(null);
    setTokenInput("");
    setDashboard(null);
    setError(message);
    setPageLoading(false);
    setRefreshing(false);
    setUpdatedAt(null);
    setScreen("locked");
  }, [cancelRequests]);

  const handleLogout = useCallback(() => lockDashboard(""), [lockDashboard]);
  const handleAuthExpired = useCallback(() => lockDashboard("Your access token has expired. Enter it again."), [lockDashboard]);

  const loadDashboard = useCallback(async (candidate: string, page: number, persistToken: boolean) => {
    const keepContent = activeToken.current === candidate && currentDashboard.current !== null;
    cancelRequests();
    const version = loadVersion.current;
    const controller = new AbortController();
    loadController.current = controller;
    activeToken.current = candidate;
    setToken(candidate);
    setError("");
    setPageLoading(false);
    setRefreshing(keepContent);
    if (!keepContent) {
      currentDashboard.current = null;
      setDashboard(null);
      setScreen("loading");
    }

    try {
      const init = { signal: controller.signal };
      const [summary, activity, recommendations] = await Promise.all([
        apiGet<DashboardSummary>("/admin/stats/summary", candidate, init),
        apiGet<DailyActivityPoint[]>("/admin/stats/daily-activity?days=30", candidate, init),
        apiGet<RecommendationPage>(`/hermes/recommendations?page=${page}&page_size=${RECOMMENDATIONS_PAGE_SIZE}`, candidate, init),
      ]);
      if (loadVersion.current !== version) return;
      if (persistToken) storeToken(candidate);
      const next = { summary, activity, recommendations };
      currentDashboard.current = next;
      setDashboard(next);
      setUpdatedAt(new Date().toISOString());
      setScreen("ready");
    } catch (caught) {
      if (loadVersion.current !== version || controller.signal.aborted) return;
      const requestError = caught as ApiError;
      if (requestError.status === 401 || requestError.status === 403) {
        lockDashboard("That access token is not valid.");
      } else {
        setError("Dashboard data is unavailable. Try again shortly.");
        setScreen(keepContent ? "ready" : "error");
      }
    } finally {
      if (loadVersion.current === version) setRefreshing(false);
    }
  }, [cancelRequests, lockDashboard]);

  useEffect(() => {
    function loadHashToken() {
      const hashToken = consumeTokenFromHash();
      if (!hashToken) return false;
      void loadDashboard(hashToken, 1, true);
      return true;
    }
    window.addEventListener("hashchange", loadHashToken);
    if (!loadHashToken()) {
      const storedToken = readStoredToken();
      if (storedToken) void loadDashboard(storedToken, 1, false);
      else setScreen("locked");
    }
    return () => {
      window.removeEventListener("hashchange", loadHashToken);
      cancelRequests();
    };
  }, [cancelRequests, loadDashboard]);

  function handleSignIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const candidate = tokenInput.trim();
    if (!candidate) {
      setError("Enter your access token to continue.");
      return;
    }
    void loadDashboard(candidate, 1, true);
  }

  async function changePage(page: number) {
    if (!token || !currentDashboard.current || pageLoading || refreshing) return;
    pageController.current?.abort();
    const controller = new AbortController();
    pageController.current = controller;
    const version = ++pageVersion.current;
    setPageLoading(true);
    setError("");
    try {
      const recommendations = await apiGet<RecommendationPage>(
        `/hermes/recommendations?page=${page}&page_size=${RECOMMENDATIONS_PAGE_SIZE}`, token, { signal: controller.signal },
      );
      if (pageVersion.current !== version || activeToken.current !== token) return;
      if (currentDashboard.current) {
        currentDashboard.current = { ...currentDashboard.current, recommendations };
        setDashboard(currentDashboard.current);
      }
    } catch (caught) {
      if (pageVersion.current !== version || controller.signal.aborted) return;
      const requestError = caught as ApiError;
      if (requestError.status === 401 || requestError.status === 403) handleAuthExpired();
      else setError("Recommendations could not be loaded.");
    } finally {
      if (pageVersion.current === version) setPageLoading(false);
    }
  }

  return {
    screen, tokenInput, setTokenInput, token, dashboard, error, setError, pageLoading, refreshing, updatedAt,
    loadDashboard, handleSignIn, handleLogout, handleAuthExpired, changePage,
  };
}
