"use client";

import { NotificationsSkeleton } from "../../components/loading/Loading";

import {
  renderNotificationIndicator,
  renderNotificationLoadError,
  renderNotificationManageLink,
} from "../notification-presentation";
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
      aria-labelledby="telegram-notifications-title"
      aria-busy={isLoading}
    >
      <div className="panel-topline notifications-topline">
        <div>
          <p className="eyebrow">Alerts</p>
          <h2 id="telegram-notifications-title">Telegram notifications</h2>
        </div>
        {renderNotificationManageLink()}
      </div>

      <div className="notifications-compact-body">
        {isLoading && !settings ? (
          <NotificationsSkeleton compact />
        ) : error && !settings ? (
          renderNotificationLoadError(error, () => void loadSettings({ reason: "initial" }))
        ) : settings ? (
          <>
            <div className="notifications-status-line">
              {renderNotificationIndicator(getStatusTone(settings), settings.status === "PENDING" && shouldPollConnection)}
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
