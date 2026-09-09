"use client";

import { RecommendationSkeleton } from "../../../components/loading/Loading";
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
import { useCallback, useEffect, useRef, useState } from "react";

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

  const requestVersion = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const currentToken = useRef<string | null>(null);
  const copyTimer = useRef<number | undefined>(undefined);
  const [retryable, setRetryable] = useState(false);

  const loadRecommendation = useCallback(async (candidate: string, persistToken: boolean) => {
    const version = ++requestVersion.current;
    controller.current?.abort();
    const requestController = new AbortController();
    controller.current = requestController;
    currentToken.current = candidate;
    if (!recommendationId) {
      setError("This recommendation link is invalid.");
      setScreen("ready");
      return;
    }
    setError("");
    setCopied(false);
    setRecommendation(null);
    setScreen("loading");
    try {
      const detail = await apiGet<RecommendationDetail>(
        `/hermes/recommendations/${encodeURIComponent(recommendationId)}`,
        candidate,
        { signal: requestController.signal },
      );
      if (requestVersion.current !== version) return;
      if (persistToken) {
        storeToken(candidate);
      }
      setRecommendation(detail);
      setScreen("ready");
    } catch (caught) {
      if (requestVersion.current !== version || requestController.signal.aborted) return;
      const requestError = caught as ApiError;
      if (requestError.status === 401 || requestError.status === 403) {
        clearStoredToken();
        currentToken.current = null;
        setError("That access token is not valid.");
        setScreen("locked");
        return;
      }
      setRecommendation(null);
      setRetryable(requestError.status !== 404);
      setError(
        requestError.status === 404
          ? "This recommendation is no longer available."
          : "This recommendation could not be loaded.",
      );
      setScreen("ready");
    }
  }, [recommendationId]);

  useEffect(() => {
    const storedToken = readStoredToken();
    if (!storedToken) {
      setScreen("locked");
      return;
    }
    void loadRecommendation(storedToken, false);
    return () => {
      requestVersion.current += 1;
      controller.current?.abort();
      window.clearTimeout(copyTimer.current);
    };
  }, [loadRecommendation]);

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
    requestVersion.current += 1;
    controller.current?.abort();
    currentToken.current = null;
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
    const version = requestVersion.current;
    try {
      await copyText(recommendation.report_markdown);
      if (requestVersion.current !== version) return;
      setCopied(true);
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      if (requestVersion.current === version) setError("This recommendation could not be copied.");
    }
  }

  if (screen === "loading") {
    return <main className="dashboard-shell">
      <DashboardTopbar backHref="/dashboard" backLabel="Dashboard" theme={theme} onThemeToggle={toggleTheme} />
      <article className="recommendation-page-main"><RecommendationSkeleton /></article>
    </main>;
  }

  if (screen === "locked") {
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
            loading={false}
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
      <article className="recommendation-page-main dashboard-content-ready">
        {recommendation ? (
          <>
            {error && <p className="dashboard-error" role="alert">{error}</p>}
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
            <p role="alert">{error}</p>
            {retryable && <button className="notification-primary-button" onClick={() => { if (currentToken.current) void loadRecommendation(currentToken.current, true); }}>Try again</button>}
            <a href="/dashboard">Back to dashboard</a>
          </section>
        )}
      </article>
    </main>
  );
}

