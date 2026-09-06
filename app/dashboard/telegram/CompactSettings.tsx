"use client";

import { ArrowUpRight, RefreshCw } from "lucide-react";
import {
  getStatusTone,
  getStatusLabel,
  getStatusCopy,
  getDeliveryLabel,
  getStateLabel,
  getTypeSummary,
} from "./helpers";
import type { TelegramSettings } from "./use-telegram-settings";

export function renderTelegramCompactSettings(state: TelegramSettings) {
  const {
    settings, isLoading, isPolling, error,
    loadSettings, pendingLinkExpired, pendingSetupUnavailable, shouldPollConnection,
    lastCheckedLabel,
  } = state;

  return (
    <section
      className="notifications-panel notifications-panel--compact"
      aria-labelledby="notifications-title"
    >
      <div className="panel-topline notifications-topline">
        <div>
          <p className="eyebrow">Alerts</p>
          <h2 id="notifications-title">Telegram notifications</h2>
        </div>
        <a className="notification-manage-link" href="/dashboard/notifications">
          Manage
          <ArrowUpRight aria-hidden="true" size={14} strokeWidth={1.8} />
        </a>
      </div>

      <div className="notifications-compact-body">
        {isLoading ? (
          <p className="notifications-muted">Loading notification settings...</p>
        ) : error && !settings ? (
          <div className="notifications-load-error" role="alert">
            <p>{error}</p>
            <button
              className="notification-secondary-button"
              type="button"
              onClick={() => void loadSettings({ reason: "initial" })}
            >
              Retry
              <RefreshCw aria-hidden="true" size={14} strokeWidth={1.8} />
            </button>
          </div>
        ) : settings ? (
          <>
            <div className="notifications-status-line">
              {settings.status === "PENDING" && shouldPollConnection ? (
                <span className="notification-spinner" aria-hidden="true" />
              ) : (
                <span
                  className={`notification-status-dot ${getStatusTone(settings)}`}
                  aria-hidden="true"
                />
              )}
              <strong>{getStatusLabel(settings.status)}</strong>
              <span>{getStatusCopy(settings)}</span>
              {settings.status === "PENDING" ? (
                <span className="notifications-status-meta">
                  {pendingSetupUnavailable
                    ? "Setup unavailable"
                    : pendingLinkExpired
                      ? "Setup link expired"
                      : `${isPolling ? "Checking" : "Waiting"} - ${lastCheckedLabel}`}
                </span>
              ) : null}
            </div>
            <div className="notifications-summary-grid">
              <article>
                <span>Delivery</span>
                <strong>{getDeliveryLabel(settings)}</strong>
              </article>
              <article>
                <span>State</span>
                <strong>{getStateLabel(settings)}</strong>
              </article>
              <article>
                <span>Events</span>
                <strong>{getTypeSummary(settings.notification_types)}</strong>
              </article>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
