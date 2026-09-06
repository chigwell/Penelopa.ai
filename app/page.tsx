"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import PenelopaHowItWorksDemo from "./components/PenelopaHowItWorksDemo";

type Theme = "light" | "dark";
type ScriptTab = "sh" | "powershell";

type PublicStatsCounters = {
  total_tokens: number;
  messages_count: number;
  recommendations_count: number;
};

type PublicStatsSummary = {
  all_time: PublicStatsCounters;
  last_24h: PublicStatsCounters;
  generated_at: string;
  cache_ttl_seconds: number;
};

type GitHubRepoStats = {
  full_name: string;
  html_url: string;
  stargazers_count: number;
  generated_at: string;
  cache_ttl_seconds: number;
};

const GITHUB_REPO_URL = "https://github.com/chigwell/penelopa.ai";
const GITHUB_REPO_NAME = "chigwell/penelopa.ai";

const INSTALL_COMMANDS: Record<ScriptTab, string> = {
  sh: "curl -fsSL https://penelopa.ai/script | sh",
  powershell: `$installer = Join-Path $env:TEMP "penelopa-auto-improve.ps1"
Invoke-WebRequest -UseBasicParsing -Uri "https://penelopa.ai/script.ps1" -OutFile $installer
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer`,
};

const METRICS = [
  { label: "Tokens", key: "total_tokens", shortLabel: "tokens" },
  { label: "Messages", key: "messages_count", shortLabel: "messages" },
  { label: "Ideas", key: "recommendations_count", shortLabel: "ideas" },
] as const;

const FEATURES = [
  ["01", "Codex + Claude Code"],
  ["02", "Durable local outbox"],
  ["03", "Process improvements"],
] as const;

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  window.localStorage.setItem("penelopa-theme", theme);
}

function formatMetric(value: number | undefined) {
  if (value === undefined) {
    return "...";
  }

  return new Intl.NumberFormat("en", {
    maximumFractionDigits: value >= 100_000 ? 1 : 0,
    notation: value >= 100_000 ? "compact" : "standard",
  }).format(value);
}

function formatStars(value: number | undefined) {
  if (value === undefined) {
    return "... stars";
  }

  return `${formatMetric(value)} ${value === 1 ? "star" : "stars"}`;
}

function formatGeneratedAt(value: string | undefined) {
  if (!value) {
    return "Updating";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Live";
  }

  return `Updated ${new Intl.DateTimeFormat("en", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  }).format(date)}`;
}

export default function Home() {
  const [theme, setTheme] = useState<Theme>("light");
  const [activeTab, setActiveTab] = useState<ScriptTab>("sh");
  const [stats, setStats] = useState<PublicStatsSummary | null>(null);
  const [statsError, setStatsError] = useState(false);
  const [githubRepo, setGithubRepo] = useState<GitHubRepoStats | null>(null);
  const [githubRepoError, setGithubRepoError] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("penelopa-theme");
    const preferredTheme =
      savedTheme === "light" || savedTheme === "dark" ? savedTheme : "light";

    setTheme(preferredTheme);
    applyTheme(preferredTheme);
  }, []);

  useEffect(() => {
    let active = true;

    fetch("/api/public-stats", { headers: { Accept: "application/json" } })
      .then((response) => {
        if (!response.ok) {
          throw new Error("stats unavailable");
        }
        return response.json() as Promise<PublicStatsSummary>;
      })
      .then((payload) => {
        if (!active) {
          return;
        }
        setStats(payload);
        setStatsError(false);
      })
      .catch(() => {
        if (active) {
          setStatsError(true);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    fetch("/api/github-repo", { headers: { Accept: "application/json" } })
      .then((response) => {
        if (!response.ok) {
          throw new Error("GitHub repo stats unavailable");
        }
        return response.json() as Promise<GitHubRepoStats>;
      })
      .then((payload) => {
        if (!active) {
          return;
        }
        setGithubRepo(payload);
        setGithubRepoError(false);
      })
      .catch(() => {
        if (active) {
          setGithubRepoError(true);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const installCommand = INSTALL_COMMANDS[activeTab];
  const generatedAtLabel = useMemo(
    () => formatGeneratedAt(stats?.generated_at),
    [stats?.generated_at],
  );

  async function copyInstallCommand() {
    try {
      await window.navigator.clipboard.writeText(installCommand);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = installCommand;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }

    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    applyTheme(nextTheme);
  }

  return (
    <main className="landing-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="/" aria-label="Penelopa.ai home">
            <span className="brand-mark" aria-hidden="true">
              <Image
                src="/penelopa-ai.png"
                alt=""
                width={42}
                height={42}
                priority
                className="brand-logo"
              />
            </span>
            <span className="brand-name">Penelopa.ai</span>
          </a>
          <div className="topbar-actions">
            <a className="dashboard-link" href="/dashboard">
              Dashboard
            </a>
            <button
              className="theme-toggle"
              type="button"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            />
          </div>
        </div>
      </header>

      <section className="hero" aria-labelledby="usage-title">
        <div className="prism-rule" aria-hidden="true" />
        <div className="hero-inner">
          <div className="hero-copy">
            <p className="eyebrow">Penelopa.ai / Auto-improve</p>
            <h1 id="usage-title">Continuous improvement for AI agents.</h1>
          </div>

          <section className="stats-board" aria-label="Public usage totals">
            <div className="stats-heading">
              <span>All time usage</span>
              <span className={statsError ? "status-error" : undefined}>
                {statsError ? "Unavailable" : generatedAtLabel}
              </span>
            </div>
            <div className="stats-grid">
              {METRICS.map((metric) => {
                const total = stats?.all_time[metric.key];
                const lastDay = stats?.last_24h[metric.key];
                return (
                  <article className="stat" key={metric.key}>
                    <span className="stat-label">{metric.label}</span>
                    <strong>{formatMetric(total)}</strong>
                    <span className="stat-subline">
                      +{formatMetric(lastDay)} {metric.shortLabel} / 24h
                    </span>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      </section>

      <section className="install-section" aria-labelledby="install-title">
        <div className="install-intro">
          <p className="eyebrow">01 / Install</p>
          <h2 id="install-title">Set it up once.</h2>
          <p className="install-detail">Codex and Claude Code. Your desktop app, ready to use.</p>
        </div>

        <div className="install-surface">
          <div className="installer-controls">
            <div className="tabs" role="tablist" aria-label="Installer type">
              <button
                className={activeTab === "sh" ? "tab active" : "tab"}
                type="button"
                role="tab"
                aria-selected={activeTab === "sh"}
                onClick={() => setActiveTab("sh")}
              >
                Mac / Linux
              </button>
              <button
                className={activeTab === "powershell" ? "tab active" : "tab"}
                type="button"
                role="tab"
                aria-selected={activeTab === "powershell"}
                onClick={() => setActiveTab("powershell")}
              >
                Win
              </button>
            </div>
            <a className="download-link" href={activeTab === "sh" ? "/script" : "/script.ps1"}>
              Download file
            </a>
          </div>

          <div className="script-box">
            <pre>
              <code>{installCommand}</code>
            </pre>
          </div>

          <div className="install-actions">
            <button className="copy-button" type="button" onClick={copyInstallCommand}>
              {copied ? "Copied" : "Copy command"}
            </button>
            <span className="api-endpoint">Mac &amp; Windows desktop · Linux hooks</span>
          </div>
        </div>
        <p className="install-detail">No Git, npm, or Python required. The installer prepares what Penelopa needs and opens your app. Review new hooks in Codex to finish connecting.</p>
      </section>

      <section className="feature-rail" aria-label="Auto-improve features">
        {FEATURES.map(([number, title]) => (
          <article className="feature-item" key={number}>
            <span>{number}</span>
            <h2>{title}</h2>
          </article>
        ))}
      </section>

      <PenelopaHowItWorksDemo theme={theme} onToggleTheme={toggleTheme} />

      <footer className="site-footer">
        <div className="site-footer-inner">
          <div className="footer-meta">
            <p>Copyright 2026 Penelopa.ai. Made by Eugene Evstafev.</p>
            <nav className="footer-links" aria-label="Legal links">
              <a href="/privacy">Privacy Policy</a>
              <a href="/terms">Terms of Service</a>
              <a href="mailto:support@penelopa.ai">support@penelopa.ai</a>
            </nav>
          </div>
          <a
            className="github-stars-link"
            href={githubRepo?.html_url ?? GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${GITHUB_REPO_NAME} on GitHub in a new tab`}
          >
            <span className="github-stars-repo">GitHub</span>
            <span className="github-stars-count" aria-live="polite">
              {githubRepoError
                ? "Stars unavailable"
                : formatStars(githubRepo?.stargazers_count)}
            </span>
          </a>
        </div>
      </footer>
    </main>
  );
}
