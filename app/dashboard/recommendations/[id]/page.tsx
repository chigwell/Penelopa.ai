"use client";

import Image from "next/image";
import { ArrowLeft, ArrowRight, Check, Copy, LogOut, Moon, Sun } from "lucide-react";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { useEffect, useState } from "react";

type Theme = "light" | "dark";
type ScreenState = "locked" | "loading" | "ready";
type ApiError = Error & { status: number };

type RecommendationDetail = {
  id: string;
  title: string;
  project_key: string | null;
  session_count: number;
  result_type: "recommendation" | "process_improvement_idea" | "insufficient_evidence" | "legacy";
  intervention_type: "script" | "skill" | "instruction" | "workflow_change" | null;
  created_at: string;
  report_markdown: string;
};

const API_BASE = "https://api.penelopa.ai/v1";
const TOKEN_STORAGE_KEY = "penelopa-api-token";

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  window.localStorage.setItem("penelopa-theme", theme);
}

function clearStoredToken() {
  try {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // The page still returns to its token gate when browser storage is unavailable.
  }
}

function readStoredToken() {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

async function apiGet<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    const error = new Error(payload?.detail || "Unable to load recommendation") as ApiError;
    error.status = response.status;
    throw error;
  }
  return response.json() as Promise<T>;
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.opacity = "0";
    textarea.style.position = "fixed";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}

export default function RecommendationPage() {
  const params = useParams<{ id?: string | string[] }>();
  const rawRecommendationId = params?.id;
  const recommendationId = Array.isArray(rawRecommendationId)
    ? rawRecommendationId[0]
    : rawRecommendationId;
  const [theme, setTheme] = useState<Theme>("light");
  const [screen, setScreen] = useState<ScreenState>("loading");
  const [tokenInput, setTokenInput] = useState("");
  const [token, setToken] = useState<string | null>(null);
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
        window.localStorage.setItem(TOKEN_STORAGE_KEY, candidate);
      }
      setToken(candidate);
      setRecommendation(detail);
      setScreen("ready");
    } catch (caught) {
      const requestError = caught as ApiError;
      if (requestError.status === 401 || requestError.status === 403) {
        clearStoredToken();
        setToken(null);
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
    const savedTheme = window.localStorage.getItem("penelopa-theme");
    const preferredTheme =
      savedTheme === "light" || savedTheme === "dark" ? savedTheme : "light";
    setTheme(preferredTheme);
    applyTheme(preferredTheme);

    const storedToken = readStoredToken();
    if (!storedToken) {
      setScreen("locked");
      return;
    }
    void loadRecommendation(storedToken, false);
  }, [recommendationId]);

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    applyTheme(nextTheme);
  }

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
    setToken(null);
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
        <RecommendationTopbar theme={theme} onThemeToggle={toggleTheme} />
        <section className="token-gate" aria-labelledby="token-title">
          <div className="token-gate-copy">
            <p className="eyebrow">Personal recommendation</p>
            <h1 id="token-title">One clear idea.</h1>
            <p>Enter the API token used by your hook.</p>
          </div>
          <form className="token-form" onSubmit={handleSignIn}>
            <label htmlFor="access-token">Access token</label>
            <div className="token-field-row">
              <input
                id="access-token"
                type="password"
                value={tokenInput}
                onChange={(event) => setTokenInput(event.target.value)}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="Paste your token"
                disabled={screen === "loading"}
              />
              <button className="token-submit" type="submit" disabled={screen === "loading"}>
                {screen === "loading" ? "Loading" : "Open"}
                <ArrowRight aria-hidden="true" size={16} strokeWidth={1.8} />
              </button>
            </div>
            <p className={error ? "token-note is-error" : "token-note"}>
              {error || "Stored only in this browser."}
            </p>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="dashboard-shell">
      <RecommendationTopbar theme={theme} onThemeToggle={toggleTheme} onLogout={handleLogout} />
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

function RecommendationTopbar({
  theme,
  onThemeToggle,
  onLogout,
}: {
  theme: Theme;
  onThemeToggle: () => void;
  onLogout?: () => void;
}) {
  return (
    <header className="dashboard-topbar">
      <div className="dashboard-topbar-inner">
        <a className="brand" href="/" aria-label="Penelopa.ai home">
          <span className="brand-mark" aria-hidden="true">
            <Image src="/penelopa-ai.png" alt="" width={42} height={42} priority className="brand-logo" />
          </span>
          <span className="brand-name">Penelopa.ai</span>
        </a>
        <div className="dashboard-actions">
          <a className="back-link" href="/dashboard">
            <ArrowLeft aria-hidden="true" size={15} strokeWidth={1.8} />
            Dashboard
          </a>
          {onLogout ? (
            <button className="icon-button" type="button" onClick={onLogout} aria-label="Log out" title="Log out">
              <LogOut aria-hidden="true" size={16} strokeWidth={1.8} />
            </button>
          ) : null}
          <button
            className="icon-button"
            type="button"
            onClick={onThemeToggle}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          >
            {theme === "dark" ? <Sun aria-hidden="true" size={16} strokeWidth={1.8} /> : <Moon aria-hidden="true" size={16} strokeWidth={1.8} />}
          </button>
        </div>
      </div>
    </header>
  );
}
