"use client";

export type { TelegramNotificationStatus, TelegramNotificationLanguage, TelegramNotificationType, TelegramNotificationState } from "../lib/api-types";

import { LANGUAGE_OPTIONS, NOTIFICATION_TYPE_OPTIONS, formatDateTime, getStatusLabel, getStatusTone, getDeliveryLabel, getStatusCopy, getStateLabel, getStateHeading, getTypeSummary, getPendingInstruction, isSetupAvailable } from "./telegram/helpers";


import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  Check,
  ExternalLink,
  Link2,
  RefreshCw,
  Trash2,
} from "lucide-react";

import { useTelegramSettings } from "./telegram/use-telegram-settings";

type ComponentMode = "compact" | "full";

export function TelegramNotificationsSettings({
  mode,
  onAuthExpired,
  token,
}: {
  mode: ComponentMode;
  onAuthExpired: () => void;
  token: string;
}) {
  const {
    settings, draftLanguage, setDraftLanguage, draftTypes,
    setupLink, isLoading, isRefreshing, isPolling,
    isSaving, isLinking, isDisconnecting, confirmDisconnect,
    now, error, message, loadSettings,
    pendingLinkExpired, pendingSetupUnavailable, shouldPollConnection, selectedTypesSummary,
    lastCheckedLabel, pendingTimeRemaining, handleToggleType, handleSave,
    handleSetEnabled, handleCreateLink, handleDisconnect,
  } = useTelegramSettings({ onAuthExpired, token });

  if (mode === "compact") {
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

  return (
    <section
      className="notifications-detail-panel"
      aria-labelledby="notification-settings-title"
    >
      <div className="panel-topline notifications-topline">
        <div>
          <p className="eyebrow">Alerts</p>
          <h2 id="notification-settings-title">Telegram setup</h2>
        </div>
        {settings ? (
          <button
            className="notification-secondary-button"
            type="button"
            onClick={() => void loadSettings({ reason: "manual" })}
            disabled={isRefreshing}
          >
            {isRefreshing ? "Refreshing" : "Refresh"}
            <RefreshCw aria-hidden="true" size={14} strokeWidth={1.8} />
          </button>
        ) : null}
      </div>

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
        <div className="notifications-settings-grid">
          <aside className="notifications-status-card">
            <span
              className={`notification-status-dot ${getStatusTone(settings)}`}
              aria-hidden="true"
            />
            <p className="eyebrow">{getStatusLabel(settings.status)}</p>
            <h3>{getStateHeading(settings)}</h3>
            <p>{getStatusCopy(settings)}</p>
            {settings.status === "PENDING" ? (
              <div
                className={
                  pendingLinkExpired || pendingSetupUnavailable
                    ? "notification-polling-status is-expired"
                    : "notification-polling-status"
                }
                role="status"
                aria-live="polite"
              >
                {pendingLinkExpired || pendingSetupUnavailable ? (
                  <span
                    className="notification-status-dot is-disabled"
                    aria-hidden="true"
                  />
                ) : (
                  <span className="notification-spinner" aria-hidden="true" />
                )}
                <span>
                  <strong>
                    {pendingSetupUnavailable
                      ? "Setup unavailable"
                      : pendingLinkExpired
                        ? "Setup link expired"
                        : isPolling
                          ? "Checking connection"
                        : "Waiting for Telegram"}
                  </strong>
                  <small>
                    {pendingSetupUnavailable
                      ? "Configuration missing"
                      : pendingLinkExpired
                        ? pendingTimeRemaining
                        : lastCheckedLabel}
                  </small>
                </span>
              </div>
            ) : null}
            <dl>
              <div>
                <dt>Telegram</dt>
                <dd>{getDeliveryLabel(settings)}</dd>
              </div>
              <div>
                <dt>Language</dt>
                <dd>{settings.language === "ru" ? "Russian" : "English"}</dd>
              </div>
              <div>
                <dt>Events</dt>
                <dd>{getTypeSummary(settings.notification_types)}</dd>
              </div>
              {settings.status === "PENDING" ? (
                <div>
                  <dt>Link expires</dt>
                  <dd>{formatDateTime(settings.link_expires_at)}</dd>
                </div>
              ) : null}
            </dl>
          </aside>

          <div className="notifications-settings-form">
            <fieldset className="notification-fieldset">
              <legend>Language</legend>
              <div className="notification-segmented-control">
                {LANGUAGE_OPTIONS.map((option) => (
                  <button
                    className={
                      draftLanguage === option.value ? "is-active" : undefined
                    }
                    type="button"
                    key={option.value}
                    onClick={() => setDraftLanguage(option.value)}
                    aria-pressed={draftLanguage === option.value}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="notification-fieldset">
              <legend>Notification types</legend>
              <div className="notification-checkbox-list">
                {NOTIFICATION_TYPE_OPTIONS.map((option) => (
                  <label className="notification-checkbox-row" key={option.value}>
                    <input
                      type="checkbox"
                      checked={draftTypes.includes(option.value)}
                      onChange={() => handleToggleType(option.value)}
                    />
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="notification-action-bar">
              <button
                className="notification-primary-button"
                type="button"
                onClick={() => void handleSave()}
                disabled={isSaving}
              >
                {isSaving ? "Saving" : "Save preferences"}
                <Check aria-hidden="true" size={15} strokeWidth={1.8} />
              </button>
              {settings.enabled ? (
                <button
                  className="notification-secondary-button"
                  type="button"
                  onClick={() => void handleSetEnabled(false)}
                  disabled={isSaving}
                >
                  Pause notifications
                </button>
              ) : settings.status === "CONNECTED" ? (
                <button
                  className="notification-primary-button"
                  type="button"
                  onClick={() => void handleSetEnabled(true)}
                  disabled={isSaving}
                >
                  Enable notifications
                  <Bell aria-hidden="true" size={15} strokeWidth={1.8} />
                </button>
              ) : null}
            </div>

            {settings.status === "PENDING" ? (
              <div className="notification-telegram-box">
                <div>
                  <p className="eyebrow">Pending connection</p>
                  <h3>{pendingSetupUnavailable ? "Setup unavailable" : "Open Telegram"}</h3>
                  <p>
                    {pendingSetupUnavailable
                      ? "Telegram bot configuration needs attention before setup can continue."
                      : getPendingInstruction(settings.link_expires_at, now)}
                  </p>
                  {pendingLinkExpired ? (
                    <p className="notification-box-warning">
                      This setup link has expired. Generate a new link.
                    </p>
                  ) : null}
                </div>
                <div className="notification-box-actions">
                  {setupLink && !pendingLinkExpired && !pendingSetupUnavailable ? (
                    <a
                      className="notification-primary-button"
                      href={setupLink}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open Telegram
                      <ExternalLink aria-hidden="true" size={15} strokeWidth={1.8} />
                    </a>
                  ) : null}
                  <button
                    className="notification-secondary-button"
                    type="button"
                    onClick={() => void handleCreateLink()}
                    disabled={isLinking || !isSetupAvailable(settings)}
                  >
                    {isLinking ? "Generating" : "Generate new link"}
                    <Link2 aria-hidden="true" size={15} strokeWidth={1.8} />
                  </button>
                </div>
              </div>
            ) : settings.status === "CONNECTED" ? (
              <div className="notification-telegram-box">
                <div>
                  <p className="eyebrow">Connected account</p>
                  <h3>{getDeliveryLabel(settings)}</h3>
                  <p>Pause notifications to keep the connection, or disconnect Telegram completely.</p>
                </div>
                <div className="notification-box-actions">
                  <button
                    className={
                      confirmDisconnect
                        ? "notification-danger-button is-confirming"
                        : "notification-danger-button"
                    }
                    type="button"
                    onClick={() => void handleDisconnect()}
                    disabled={isDisconnecting}
                  >
                    {confirmDisconnect ? "Confirm disconnect" : "Disconnect"}
                    <Trash2 aria-hidden="true" size={15} strokeWidth={1.8} />
                  </button>
                </div>
              </div>
            ) : (
              <div className="notification-telegram-box">
                <div>
                  <p className="eyebrow">Telegram connection</p>
                  <h3>
                    {isSetupAvailable(settings)
                      ? "Connect Telegram"
                      : "Setup unavailable"}
                  </h3>
                  <p>
                    {isSetupAvailable(settings)
                      ? "Generate a setup link, open it, and start the bot."
                      : "Telegram bot configuration needs attention before setup can start."}
                  </p>
                </div>
                <div className="notification-box-actions">
                  <button
                    className="notification-primary-button"
                    type="button"
                    onClick={() => void handleCreateLink()}
                    disabled={isLinking || !isSetupAvailable(settings)}
                  >
                    {isLinking ? "Generating" : "Connect Telegram"}
                    <ArrowRight aria-hidden="true" size={15} strokeWidth={1.8} />
                  </button>
                </div>
              </div>
            )}

            {error ? (
              <p className="notification-form-message is-error" role="alert">
                {error}
              </p>
            ) : message ? (
              <p className="notification-form-message">{message}</p>
            ) : (
              <p className="notification-form-message">
                Selected events: {selectedTypesSummary}.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
