"use client";

import { useTheme } from "../lib/use-theme";

import type { DashboardSummary, DailyActivityPoint, Recommendation, RecommendationPage, RecommendationDetail, DashboardData } from "../lib/api-types";
import { formatMetric, formatDelta, formatUpdated, formatDay, formatDateTime } from "../lib/formatting";
import { copyText } from "../lib/clipboard";
import type { ApiError } from "../lib/penelopa-client";

import { apiGet, clearStoredToken, storeToken, readStoredToken, consumeTokenFromHash, useDesktop } from "../lib/penelopa-client";
import { DashboardTopbar, AccessTokenForm } from "./PageChrome";

import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TelegramNotificationsSettings } from "./TelegramNotifications";

type ScreenState = "locked" | "loading" | "ready";

type ChartKey =
  | "sessions_count"
  | "messages_count"
  | "projects_count"
  | "recommendations_count"
  | "processed_tokens_total";

const RECOMMENDATIONS_PAGE_SIZE = 10;

const CHART_SERIES: ReadonlyArray<{
  key: ChartKey;
  label: string;
  color: string;
  axis: "counts" | "tokens";
}> = [
  { key: "sessions_count", label: "Sessions", color: "var(--chart-session)", axis: "counts" },
  { key: "messages_count", label: "Messages", color: "var(--chart-messages)", axis: "counts" },
  { key: "projects_count", label: "Projects", color: "var(--chart-projects)", axis: "counts" },
  { key: "recommendations_count", label: "Recommendations", color: "var(--chart-recommendations)", axis: "counts" },
  { key: "processed_tokens_total", label: "Tokens", color: "var(--chart-tokens)", axis: "tokens" },
];

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
  const totalPages = Math.max(1, Math.ceil(recommendations.total / recommendations.page_size));
  const totalCards = [
    ["Tokens", summary.processed_tokens_total, summary.processed_tokens_delta_24h],
    ["Sessions", summary.saved_sessions_count, summary.saved_sessions_delta_24h],
    ["Messages", summary.saved_messages_count, summary.saved_messages_delta_24h],
    ["Projects", summary.unique_projects_count, summary.unique_projects_delta_24h],
    ["Recommendations", summary.recommendations_count, summary.recommendations_delta_24h],
  ] as const;

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

        <section className="total-cards" aria-label="Usage totals">
          {totalCards.map(([label, total, delta]) => (
            <article className="total-card" key={label}>
              <span>{label}</span>
              <strong>{formatMetric(total)}</strong>
              <small>{formatDelta(delta)}</small>
            </article>
          ))}
        </section>

        <TelegramNotificationsSettings
          mode="compact"
          token={token}
          onAuthExpired={handleAuthExpired}
        />

        <section className="activity-panel" aria-labelledby="activity-title">
          <div className="panel-topline">
            <div>
              <p className="eyebrow">30 day view</p>
              <h2 id="activity-title">Daily activity</h2>
            </div>
            <div className="series-controls" aria-label="Chart series">
              {CHART_SERIES.map((series) => (
                <button
                  className={activeSeries.includes(series.key) ? "series-toggle active" : "series-toggle"}
                  type="button"
                  key={series.key}
                  onClick={() => toggleSeries(series.key)}
                  aria-pressed={activeSeries.includes(series.key)}
                >
                  <span style={{ backgroundColor: series.color }} aria-hidden="true" />
                  {series.label}
                </button>
              ))}
            </div>
          </div>

          <div className="activity-chart" aria-label="30-day daily activity chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 12, right: 0, bottom: 0, left: 0 }}>
                <defs>
                  {CHART_SERIES.map((series) => (
                    <linearGradient id={`activity-${series.key}`} key={series.key} x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor={series.color} stopOpacity={0.22} />
                      <stop offset="100%" stopColor={series.color} stopOpacity={0} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid stroke="currentColor" strokeDasharray="2 6" vertical={false} />
                <XAxis
                  axisLine={false}
                  dataKey="label"
                  interval="preserveStartEnd"
                  minTickGap={26}
                  tickLine={false}
                />
                <YAxis axisLine={false} hide tickLine={false} yAxisId="counts" />
                <YAxis axisLine={false} hide tickLine={false} yAxisId="tokens" orientation="right" />
                <Tooltip
                  contentStyle={{
                    background: "var(--surface-raised)",
                    border: "1px solid var(--border)",
                    borderRadius: 0,
                    color: "var(--ink)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                  }}
                  formatter={(value) => formatMetric(Number(value))}
                />
                {CHART_SERIES.filter((series) => activeSeries.includes(series.key)).map((series) => (
                  <Area
                    dataKey={series.key}
                    dot={false}
                    fill={`url(#activity-${series.key})`}
                    fillOpacity={1}
                    isAnimationActive={false}
                    key={series.key}
                    name={series.label}
                    stroke={series.color}
                    strokeWidth={1.7}
                    type="monotone"
                    yAxisId={series.axis}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="recommendations-panel" aria-labelledby="recommendations-title">
          <div className="panel-topline recommendations-heading">
            <div>
              <p className="eyebrow">Process improvements</p>
              <h2 id="recommendations-title">Recommendations</h2>
            </div>
            <span>{recommendations.total} total</span>
          </div>

          <div className="recommendations-table-wrap">
            <table className="recommendations-table">
              <thead>
                <tr>
                  <th scope="col">Recommendation</th>
                  <th scope="col">Project</th>
                  <th scope="col">Sessions</th>
                  <th scope="col">Created</th>
                  <th scope="col"><span className="sr-only">Open page</span></th>
                  <th scope="col"><span className="sr-only">Copy</span></th>
                </tr>
              </thead>
              <tbody aria-busy={pageLoading}>
                {recommendations.items.length ? recommendations.items.map((item) => {
                  const isExpanded = expandedId === item.id;
                  return (
                    <Fragment key={item.id}>
                      <tr className={isExpanded ? "recommendation-row is-expanded" : "recommendation-row"}>
                        <td>
                          <button
                            className="recommendation-expand-trigger"
                            type="button"
                            onClick={() => void toggleRecommendation(item)}
                            aria-expanded={isExpanded}
                            aria-controls={`recommendation-detail-${item.id}`}
                          >
                            <span>
                              <span className="recommendation-title">{item.title}</span>
                              <span className="recommendation-kind">{item.intervention_type || item.result_type}</span>
                            </span>
                            <ChevronDown className="recommendation-chevron" aria-hidden="true" size={16} strokeWidth={1.7} />
                          </button>
                        </td>
                        <td>{item.project_key || "No project"}</td>
                        <td>{item.session_count}</td>
                        <td>{formatDateTime(item.created_at)}</td>
                        <td>
                          <a
                            className="page-icon-link"
                            href={`/dashboard/recommendations/${encodeURIComponent(item.id)}`}
                            aria-label={`Open ${item.title}`}
                            title="Open full page"
                          >
                            <ArrowUpRight aria-hidden="true" size={16} />
                          </a>
                        </td>
                        <td>
                          <button
                            className="copy-icon-button"
                            type="button"
                            onClick={() => void copyRecommendation(item)}
                            aria-label={`Copy ${item.title}`}
                            title="Copy recommendation"
                          >
                            {copiedId === item.id ? <Check aria-hidden="true" size={16} /> : <Copy aria-hidden="true" size={16} />}
                          </button>
                        </td>
                      </tr>
                      {isExpanded ? (
                        <tr className="recommendation-detail-row" id={`recommendation-detail-${item.id}`}>
                          <td colSpan={6}>
                            {expandedLoading ? (
                              <p className="recommendation-loading">Loading full recommendation...</p>
                            ) : expandedRecommendation ? (
                              <div className="recommendation-inline-detail">
                                <div className="inline-detail-topline">
                                  <span>{expandedRecommendation.project_key || "No project"}</span>
                                  <a href={`/dashboard/recommendations/${encodeURIComponent(item.id)}`}>
                                    Open page <ArrowUpRight aria-hidden="true" size={14} />
                                  </a>
                                </div>
                                <div className="recommendation-report">
                                  <ReactMarkdown>{expandedRecommendation.report_markdown}</ReactMarkdown>
                                </div>
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                }) : (
                  <tr>
                    <td className="empty-row" colSpan={6}>No recommendations yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <nav className="pagination" aria-label="Recommendation pages">
            <span>Page {recommendations.page} of {totalPages}</span>
            <div>
              <button
                type="button"
                onClick={() => void changePage(recommendations.page - 1)}
                disabled={recommendations.page === 1 || pageLoading}
                aria-label="Previous recommendations page"
                title="Previous page"
              >
                <ChevronLeft aria-hidden="true" size={17} />
              </button>
              <button
                type="button"
                onClick={() => void changePage(recommendations.page + 1)}
                disabled={recommendations.page === totalPages || pageLoading}
                aria-label="Next recommendations page"
                title="Next page"
              >
                <ChevronRight aria-hidden="true" size={17} />
              </button>
            </div>
          </nav>
        </section>
      </div>
    </main>
  );
}

