"use client";

import { useTheme } from "../../lib/use-theme";

import { clearStoredToken, storeToken, readStoredToken, consumeTokenFromHash, useDesktop } from "../../lib/penelopa-client";
import { DashboardTopbar, AccessTokenForm } from "../PageChrome";

import { useCallback, useEffect, useState } from "react";
import { TelegramNotificationsSettings } from "../TelegramNotifications";

type ScreenState = "locked" | "loading" | "ready";

export default function TelegramNotificationsPage() {
  const desktop = useDesktop();
  const { theme, toggleTheme } = useTheme();
  const [screen, setScreen] = useState<ScreenState>("loading");
  const [tokenInput, setTokenInput] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
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
        <DashboardTopbar backHref="/dashboard" backLabel="Dashboard" theme={theme} onThemeToggle={toggleTheme} />
        <section className="token-gate" aria-labelledby="token-title">
          <div className="token-gate-copy">
            <p className="eyebrow">Telegram notifications</p>
            <h1 id="token-title">Your alerts.</h1>
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
      <DashboardTopbar backHref="/dashboard" backLabel="Dashboard"
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

