"use client";

import { apiGet, clearStoredToken, storeToken, readStoredToken, consumeTokenFromHash, useDesktop } from "../../lib/penelopa-client";
import { DesktopSignIn } from "../DesktopSignIn";

import Image from "next/image";
import { ArrowLeft, ArrowRight, LogOut, Moon, Sun } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { TelegramNotificationsSettings } from "../TelegramNotifications";

type Theme = "light" | "dark";
type ScreenState = "locked" | "loading" | "ready";

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  window.localStorage.setItem("penelopa-theme", theme);
}

export default function TelegramNotificationsPage() {
  const desktop = useDesktop();
  const [theme, setTheme] = useState<Theme>("light");
  const [screen, setScreen] = useState<ScreenState>("loading");
  const [tokenInput, setTokenInput] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("penelopa-theme");
    const preferredTheme =
      savedTheme === "light" || savedTheme === "dark" ? savedTheme : "light";
    setTheme(preferredTheme);
    applyTheme(preferredTheme);

    function acceptToken(candidate: string) {
      storeToken(candidate);
      setToken(candidate);
      setError("");
      setScreen("ready");
    }

    function loadHashToken() {
      const hashToken = consumeTokenFromHash();
      if (!hashToken) {
        return false;
      }
      acceptToken(hashToken);
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

    setToken(storedToken);
    setScreen("ready");

    return () => window.removeEventListener("hashchange", loadHashToken);
  }, []);

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

    storeToken(candidate);

    setToken(candidate);
    setError("");
    setScreen("ready");
  }

  function handleLogout() {
    clearStoredToken();
    setToken(null);
    setTokenInput("");
    setError("");
    setScreen("locked");
  }

  const handleAuthExpired = useCallback(() => {
    clearStoredToken();
    setToken(null);
    setTokenInput("");
    setError("Your access token has expired. Enter it again.");
    setScreen("locked");
  }, []);

  if (screen !== "ready" || !token) {
    return (
      <main className="dashboard-shell token-shell">
        <NotificationsTopbar theme={theme} onThemeToggle={toggleTheme} />
        <section className="token-gate" aria-labelledby="token-title">
          <div className="token-gate-copy">
            <p className="eyebrow">Telegram notifications</p>
            <h1 id="token-title">Your alerts.</h1>
            <p>{desktop ? "Open Connection to reconnect your installed account." : "Enter the API token used by your hook."}</p>
          </div>
          {desktop ? <DesktopSignIn /> : <form className="token-form" onSubmit={handleSignIn}>
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
          </form>}
        </section>
      </main>
    );
  }

  return (
    <main className="dashboard-shell">
      <NotificationsTopbar
        theme={theme}
        onThemeToggle={toggleTheme}
        onLogout={handleLogout}
      />
      <article className="notification-page-main">
        <header className="notification-page-heading">
          <p className="eyebrow">Personal dashboard</p>
          <h1>Telegram notifications.</h1>
          <p>Choose the alerts Penelopa sends to your Telegram account.</p>
        </header>
        <TelegramNotificationsSettings
          mode="full"
          token={token}
          onAuthExpired={handleAuthExpired}
        />
      </article>
    </main>
  );
}

function NotificationsTopbar({
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
