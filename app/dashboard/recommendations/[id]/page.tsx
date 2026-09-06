"use client";

import { useTheme } from "../../../lib/use-theme";

import type { RecommendationDetail } from "../../../lib/api-types";
import { formatDateTime } from "../../../lib/formatting";
import { copyText } from "../../../lib/clipboard";
import type { ApiError } from "../../../lib/penelopa-client";

import { apiGet, clearStoredToken, storeToken, readStoredToken, useDesktop } from "../../../lib/penelopa-client";
import { DashboardTopbar, AccessTokenForm } from "../../PageChrome";

import { Check, Copy } from "lucide-react";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { useEffect, useState } from "react";

type ScreenState = "locked" | "loading" | "ready";

export default function RecommendationPage() {
  const desktop = useDesktop();
  const params = useParams<{ id?: string | string[] }>();
  const rawRecommendationId = params?.id;
  const recommendationId = Array.isArray(rawRecommendationId)
    ? rawRecommendationId[0]
    : rawRecommendationId;
  const { theme, toggleTheme } = useTheme(recommendationId);
  const [screen, setScreen] = useState<ScreenState>("loading");
  const [tokenInput, setTokenInput] = useState("");
  const [recommendation, setRecommendation] = useState<RecommendationDetail | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function loadRecommendation(candidate: string, persistToken: boolean) {
    if (!recommendationId) {
      setError("This recommendation link is invalid.");
      setScreen("ready");
      return;
    }
    setError("");
    setScreen("loading");
    try {
      const detail = await apiGet<RecommendationDetail>(
        `/hermes/recommendations/${encodeURIComponent(recommendationId)}`,
        candidate,
      );
      if (persistToken) {
        storeToken(candidate);
      }
      setRecommendation(detail);
      setScreen("ready");
    } catch (caught) {
      const requestError = caught as ApiError;
      if (requestError.status === 401 || requestError.status === 403) {
        clearStoredToken();
        setError("That access token is not valid.");
        setScreen("locked");
        return;
      }
      setRecommendation(null);
      setError(
        requestError.status === 404
          ? "This recommendation is no longer available."
          : "This recommendation could not be loaded.",
      );
      setScreen("ready");
    }
  }

  useEffect(() => {
    const storedToken = readStoredToken();
    if (!storedToken) {
      setScreen("locked");
      return;
    }
    void loadRecommendation(storedToken, false);
  }, [recommendationId]);

  function handleSignIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const candidate = tokenInput.trim();
    if (!candidate) {
      setError("Enter your access token to continue.");
      return;
    }
    void loadRecommendation(candidate, true);
  }

  function handleLogout() {
    clearStoredToken();
    setTokenInput("");
    setRecommendation(null);
    setError("");
    setScreen("locked");
  }

  async function copyRecommendation() {
    if (!recommendation) {
      return;
    }
    await copyText(recommendation.report_markdown);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  if (screen !== "ready") {
    return (
      <main className="dashboard-shell token-shell">
        <DashboardTopbar backHref="/dashboard" backLabel="Dashboard" theme={theme} onThemeToggle={toggleTheme} />
        <section className="token-gate" aria-labelledby="token-title">
          <div className="token-gate-copy">
            <p className="eyebrow">Personal recommendation</p>
            <h1 id="token-title">One clear idea.</h1>
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

  return (
    <main className="dashboard-shell">
      <DashboardTopbar backHref="/dashboard" backLabel="Dashboard" theme={theme} onThemeToggle={toggleTheme} onLogout={handleLogout} />
      <article className="recommendation-page-main">
        {recommendation ? (
          <>
            <header className="recommendation-page-heading">
              <p className="eyebrow">Recommendation</p>
              <h1>{recommendation.title}</h1>
              <div className="recommendation-page-meta">
                <span>{recommendation.project_key || "No project"}</span>
                <span>{recommendation.session_count} sessions</span>
                <span>{formatDateTime(recommendation.created_at)}</span>
                <span>{recommendation.intervention_type || recommendation.result_type}</span>
              </div>
              <button className="recommendation-copy-command" type="button" onClick={() => void copyRecommendation()}>
                {copied ? <Check aria-hidden="true" size={16} /> : <Copy aria-hidden="true" size={16} />}
                {copied ? "Copied" : "Copy recommendation"}
              </button>
            </header>
            <section className="recommendation-report-page" aria-label="Recommendation detail">
              <div className="recommendation-report">
                <ReactMarkdown>{recommendation.report_markdown}</ReactMarkdown>
              </div>
            </section>
          </>
        ) : (
          <section className="detail-empty-state">
            <p className="eyebrow">Recommendation</p>
            <h1>Unavailable.</h1>
            <p>{error}</p>
            <a href="/dashboard">Back to dashboard</a>
          </section>
        )}
      </article>
    </main>
  );
}

