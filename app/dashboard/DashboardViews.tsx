"use client";

import { Fragment } from "react";
import { ArrowUpRight, Check, ChevronDown, ChevronLeft, ChevronRight, Copy } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DashboardSummary, DailyActivityPoint, Recommendation, RecommendationPage, RecommendationDetail } from "../lib/api-types";
import { formatMetric, formatDelta, formatDateTime } from "../lib/formatting";

export type ChartKey =
  | "sessions_count"
  | "messages_count"
  | "projects_count"
  | "recommendations_count"
  | "processed_tokens_total";

export const CHART_SERIES: ReadonlyArray<{
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

export function DashboardSummaryView({ summary }: { summary: DashboardSummary }) {
  const totalCards = [
    ["Tokens", summary.processed_tokens_total, summary.processed_tokens_delta_24h],
    ["Sessions", summary.saved_sessions_count, summary.saved_sessions_delta_24h],
    ["Messages", summary.saved_messages_count, summary.saved_messages_delta_24h],
    ["Projects", summary.unique_projects_count, summary.unique_projects_delta_24h],
    ["Recommendations", summary.recommendations_count, summary.recommendations_delta_24h],
  ] as const;

  return (
    <section className="total-cards" aria-label="Usage totals">
      {totalCards.map(([label, total, delta]) => (
        <article className="total-card" key={label}>
          <span>{label}</span>
          <strong>{formatMetric(total)}</strong>
          <small>{formatDelta(delta)}</small>
        </article>
      ))}
    </section>
  );
}

export function DashboardActivityView({ chartData, activeSeries, toggleSeries }: {
  chartData: Array<DailyActivityPoint & { label: string }>;
  activeSeries: ChartKey[];
  toggleSeries: (key: ChartKey) => void;
}) {
  return (
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
  );
}

export function DashboardRecommendationsView({
  recommendations, pageLoading, copiedId, expandedId, expandedRecommendation,
  expandedLoading, changePage, copyRecommendation, toggleRecommendation,
}: {
  recommendations: RecommendationPage;
  pageLoading: boolean;
  copiedId: string | null;
  expandedId: string | null;
  expandedRecommendation: RecommendationDetail | null;
  expandedLoading: boolean;
  changePage: (page: number) => Promise<void>;
  copyRecommendation: (item: Recommendation) => Promise<void>;
  toggleRecommendation: (item: Recommendation) => Promise<void>;
}) {
  const totalPages = Math.max(1, Math.ceil(recommendations.total / recommendations.page_size));
  return (
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
  );
}
