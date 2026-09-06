"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, clearStoredToken, storeToken, readStoredToken, consumeTokenFromHash, type ApiError } from "../lib/penelopa-client";
import type { DashboardSummary, DailyActivityPoint, RecommendationPage, DashboardData } from "../lib/api-types";

type ScreenState = "locked" | "loading" | "ready";
const RECOMMENDATIONS_PAGE_SIZE = 10;

export function useDashboardData() {
  const [screen, setScreen] = useState<ScreenState>("loading");
  const [tokenInput, setTokenInput] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [pageLoading, setPageLoading] = useState(false);

  async function loadDashboard(candidate: string, page: number, persistToken: boolean) {
    setError("");
    setScreen("loading");

    try {
      const [summary, activity, recommendations] = await Promise.all([
        apiGet<DashboardSummary>("/admin/stats/summary", candidate),
        apiGet<DailyActivityPoint[]>("/admin/stats/daily-activity?days=30", candidate),
        apiGet<RecommendationPage>(
          `/hermes/recommendations?page=${page}&page_size=${RECOMMENDATIONS_PAGE_SIZE}`,
          candidate,
        ),
      ]);

      if (persistToken) {
        storeToken(candidate);
      }
      setToken(candidate);
      setDashboard({ summary, activity, recommendations });
      setScreen("ready");
    } catch (caught) {
      const requestError = caught as ApiError;
      if (requestError.status === 401 || requestError.status === 403) {
        clearStoredToken();
        setToken(null);
        setError("That access token is not valid.");
      } else {
        setError("Dashboard data is unavailable. Try again shortly.");
      }
      setDashboard(null);
      setScreen("locked");
    }
  }

  useEffect(() => {
    function loadHashToken() {
      const hashToken = consumeTokenFromHash();
      if (!hashToken) {
        return false;
      }
      void loadDashboard(hashToken, 1, true);
      return true;
    }

    window.addEventListener("hashchange", loadHashToken);

    if (loadHashToken()) {
      return () => window.removeEventListener("hashchange", loadHashToken);
    }

    const storedToken = readStoredToken();
    if (!storedToken) {
      setScreen("locked");
      return () => window.removeEventListener("hashchange", loadHashToken);
    }
    void loadDashboard(storedToken, 1, false);

    return () => window.removeEventListener("hashchange", loadHashToken);
  }, []);

  function handleSignIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const candidate = tokenInput.trim();
    if (!candidate) {
      setError("Enter your access token to continue.");
      return;
    }
    void loadDashboard(candidate, 1, true);
  }

  function handleLogout() {
    clearStoredToken();
    setToken(null);
    setTokenInput("");
    setDashboard(null);
    setError("");
    setScreen("locked");
  }

  const handleAuthExpired = useCallback(() => {
    clearStoredToken();
    setToken(null);
    setTokenInput("");
    setDashboard(null);
    setError("Your access token has expired. Enter it again.");
    setScreen("locked");
  }, []);

  async function changePage(page: number) {
    if (!token || !dashboard || pageLoading) {
      return;
    }

    setPageLoading(true);
    setError("");
    try {
      const recommendations = await apiGet<RecommendationPage>(
        `/hermes/recommendations?page=${page}&page_size=${RECOMMENDATIONS_PAGE_SIZE}`,
        token,
      );
      setDashboard((current) =>
        current ? { ...current, recommendations } : current,
      );
    } catch (caught) {
      const requestError = caught as ApiError;
      if (requestError.status === 401 || requestError.status === 403) {
        handleLogout();
        setError("Your access token has expired. Enter it again.");
      } else {
        setError("Recommendations could not be loaded.");
      }
    } finally {
      setPageLoading(false);
    }
  }

  return {
    screen, tokenInput, setTokenInput, token, dashboard, error, setError, pageLoading,
    loadDashboard, handleSignIn, handleLogout, handleAuthExpired, changePage,
  };
}
