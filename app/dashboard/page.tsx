"use client";

import { useTheme } from "../lib/use-theme";

import type { DashboardSummary, DailyActivityPoint, Recommendation, RecommendationPage, RecommendationDetail, DashboardData } from "../lib/api-types";
import { formatUpdated, formatDay } from "../lib/formatting";
import { copyText } from "../lib/clipboard";
import type { ApiError } from "../lib/penelopa-client";

import { apiGet, clearStoredToken, storeToken, readStoredToken, consumeTokenFromHash, useDesktop } from "../lib/penelopa-client";
import { DashboardTopbar, AccessTokenForm } from "./PageChrome";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CHART_SERIES, DashboardSummaryView, DashboardActivityView, DashboardRecommendationsView, type ChartKey } from "./DashboardViews";
import { TelegramNotificationsSettings } from "./TelegramNotifications";

type ScreenState = "locked" | "loading" | "ready";

const RECOMMENDATIONS_PAGE_SIZE = 10;

export default function DashboardPage() {
  const desktop = useDesktop();
  const { theme, toggleTheme } = useTheme();
  const [screen, setScreen] = useState<ScreenState>("loading");
  const [tokenInput, setTokenInput] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [pageLoading, setPageLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedRecommendation, setExpandedRecommendation] =
    useState<RecommendationDetail | null>(null);
  const [expandedLoading, setExpandedLoading] = useState(false);
  const [activeSeries, setActiveSeries] = useState<ChartKey[]>(
    CHART_SERIES.map((series) => series.key),
  );

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

  const chartData = useMemo(
    () =>
      dashboard?.activity.map((point) => ({
        ...point,
        label: formatDay(point.day),
      })) ?? [],
    [dashboard?.activity],
  );

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

  async function copyRecommendation(item: Recommendation) {
    if (!token) {
      return;
    }

    try {
      const detail = await apiGet<RecommendationDetail>(
        `/hermes/recommendations/${item.id}`,
        token,
      );
      await copyText(detail.report_markdown);
      setCopiedId(item.id);
      window.setTimeout(() => setCopiedId(null), 1600);
    } catch (caught) {
      const requestError = caught as ApiError;
      if (requestError.status === 401 || requestError.status === 403) {
        handleLogout();
        setError("Your access token has expired. Enter it again.");
        return;
      }
      setError("This recommendation could not be copied.");
    }
  }

  async function toggleRecommendation(item: Recommendation) {
    if (expandedId === item.id) {
      setExpandedId(null);
      setExpandedRecommendation(null);
      return;
    }
    if (!token) {
      return;
    }

    setExpandedId(item.id);
    setExpandedRecommendation(null);
    setExpandedLoading(true);
    setError("");
    try {
      const detail = await apiGet<RecommendationDetail>(
        `/hermes/recommendations/${item.id}`,
        token,
      );
      setExpandedRecommendation(detail);
    } catch (caught) {
      const requestError = caught as ApiError;
      if (requestError.status === 401 || requestError.status === 403) {
        handleLogout();
        setError("Your access token has expired. Enter it again.");
      } else {
        setError("This recommendation could not be loaded.");
      }
    } finally {
      setExpandedLoading(false);
    }
  }

  function toggleSeries(key: ChartKey) {
    setActiveSeries((current) => {
      if (current.includes(key)) {
        return current.length === 1 ? current : current.filter((item) => item !== key);
      }
      return [...current, key];
    });
  }

  if (screen !== "ready" || !dashboard || !token) {
    return (
      <main className="dashboard-shell token-shell">
        <DashboardTopbar theme={theme} onThemeToggle={toggleTheme} />
        <section className="token-gate" aria-labelledby="token-title">
          <div className="token-gate-copy">
            <p className="eyebrow">Personal dashboard</p>
            <h1 id="token-title">Your own usage.</h1>
            <p>{desktop ? "Open Connection to reconnect your installed account." : "Enter the API token used by your hook."}</p>
          </div>
          <AccessTokenForm
            desktop={desktop}
            loading={screen === "loading"}
            value={tokenInput}
            onChange={setTokenInput}
            error={error}
            onSubmit={handleSignIn}
          />
        </section>
      </main>
    );
  }

  const { summary, recommendations } = dashboard;

  return (
    <main className="dashboard-shell">
      <DashboardTopbar
        theme={theme}
        onThemeToggle={toggleTheme}
        onLogout={handleLogout}
        onRefresh={() => void loadDashboard(token, recommendations.page, false)}
      />

      <div className="dashboard-main">
        <section className="dashboard-title" aria-labelledby="dashboard-title">
          <div>
            <p className="eyebrow">Personal dashboard</p>
            <h1 id="dashboard-title">Your activity.</h1>
          </div>
          <p>Live view · {formatUpdated(new Date().toISOString())}</p>
        </section>

        {error ? <p className="dashboard-error" role="alert">{error}</p> : null}

        <DashboardSummaryView summary={summary} />

        <TelegramNotificationsSettings
          mode="compact"
          token={token}
          onAuthExpired={handleAuthExpired}
        />

        <DashboardActivityView chartData={chartData} activeSeries={activeSeries} toggleSeries={toggleSeries} />

        <DashboardRecommendationsView
          recommendations={recommendations}
          pageLoading={pageLoading}
          copiedId={copiedId}
          expandedId={expandedId}
          expandedRecommendation={expandedRecommendation}
          expandedLoading={expandedLoading}
          changePage={changePage}
          copyRecommendation={copyRecommendation}
          toggleRecommendation={toggleRecommendation}
        />
      </div>
    </main>
  );
}

