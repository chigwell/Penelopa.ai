"use client";

import { useTheme } from "../lib/use-theme";

import { formatUpdated, formatDay } from "../lib/formatting";

import { useDesktop } from "../lib/penelopa-client";
import { DashboardTopbar, AccessTokenForm } from "./PageChrome";

import { useMemo, useState } from "react";
import { CHART_SERIES, DashboardSummaryView, DashboardActivityView, DashboardRecommendationsView, type ChartKey } from "./DashboardViews";
import { useDashboardData } from "./use-dashboard-data";
import { useRecommendationReports } from "./use-recommendation-reports";
import { TelegramNotificationsSettings } from "./TelegramNotifications";

export default function DashboardPage() {
  const desktop = useDesktop();
  const { theme, toggleTheme } = useTheme();
  const {
    screen, tokenInput, setTokenInput, token, dashboard, error, setError, pageLoading,
    loadDashboard, handleSignIn, handleLogout, handleAuthExpired, changePage,
  } = useDashboardData();
  const {
    copiedId, expandedId, expandedRecommendation, expandedLoading,
    copyRecommendation, toggleRecommendation,
  } = useRecommendationReports(token, handleLogout, setError);
  const [activeSeries, setActiveSeries] = useState<ChartKey[]>(
    CHART_SERIES.map((series) => series.key),
  );

  const chartData = useMemo(
    () =>
      dashboard?.activity.map((point) => ({
        ...point,
        label: formatDay(point.day),
      })) ?? [],
    [dashboard?.activity],
  );

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

