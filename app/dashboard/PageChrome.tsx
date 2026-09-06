"use client";

import Image from "next/image";
import { ArrowLeft, ArrowRight, LogOut, Moon, RefreshCw, Sun } from "lucide-react";
import type { FormEvent } from "react";
import type { Theme } from "../lib/use-theme";
import { DesktopSignIn } from "./DesktopSignIn";

export function DashboardTopbar({
  theme,
  onThemeToggle,
  onLogout,
  onRefresh,
  backHref = "/",
  backLabel = "Public usage",
}: {
  theme: Theme;
  onThemeToggle: () => void;
  onLogout?: () => void;
  onRefresh?: () => void;
  backHref?: string;
  backLabel?: string;
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
          <a className="back-link" href={backHref}>
            <ArrowLeft aria-hidden="true" size={15} strokeWidth={1.8} />
            {backLabel}
          </a>
          {onRefresh ? (
            <button className="icon-button" type="button" onClick={onRefresh} aria-label="Refresh dashboard" title="Refresh dashboard">
              <RefreshCw aria-hidden="true" size={16} strokeWidth={1.8} />
            </button>
          ) : null}
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

export function AccessTokenForm({
  desktop,
  loading,
  value,
  onChange,
  error,
  onSubmit,
}: {
  desktop: boolean;
  loading: boolean;
  value: string;
  onChange: (value: string) => void;
  error: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return desktop ? <DesktopSignIn /> : (
    <form className="token-form" onSubmit={onSubmit}>
      <label htmlFor="access-token">Access token</label>
      <div className="token-field-row">
        <input
          id="access-token"
          type="password"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="Paste your token"
          disabled={loading}
        />
        <button className="token-submit" type="submit" disabled={loading}>
          {loading ? "Loading" : "Open"}
          <ArrowRight aria-hidden="true" size={16} strokeWidth={1.8} />
        </button>
      </div>
      <p className={error ? "token-note is-error" : "token-note"}>
        {error || "Stored only in this browser."}
      </p>
    </form>
  );
}
