"use client";

import { NotificationsSkeleton } from "../../components/loading/Loading";

import { Check, RefreshCw, Trash2 } from "lucide-react";
import {
  WEBHOOK_EVENT_LABEL,
  formatWebhookDateTime,
  getWebhookDeliveryLabel,
  getWebhookSecretLabel,
  getWebhookStateHeading,
  getWebhookStatusCopy,
  getWebhookStatusLabel,
  getWebhookStatusTone,
} from "./helpers";
import type { WebhookSettings } from "./use-webhook-settings";

export function renderWebhookFullSettings(state: WebhookSettings) {
  const {
    settings, draftEnabled, setDraftEnabled, draftUrl, draftSecret, clearSecret,
    isLoading, isRefreshing, isSaving, isDisconnecting, confirmDisconnect,
    error, message, loadSettings, handleDraftUrlChange, handleDraftSecretChange,
    handleClearSecretChange, handleSave, handleDisconnect,
  } = state;
  const canDisconnect = Boolean(
    settings && (settings.enabled || settings.url || settings.secret_configured),
  );

  return (
    <section
      className="notifications-detail-panel webhook-detail-panel"
      aria-labelledby="webhook-settings-title"
      aria-busy={isLoading || isRefreshing}
    >
      <div className="panel-topline notifications-topline">
        <div>
          <p className="eyebrow">Webhooks</p>
          <h2 id="webhook-settings-title">Webhook delivery</h2>
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

      {isLoading && !settings ? (
        <NotificationsSkeleton />
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
              className={`notification-status-dot ${getWebhookStatusTone(settings)}`}
              aria-hidden="true"
            />
            <p className="eyebrow">{getWebhookStatusLabel(settings)}</p>
            <h3>{getWebhookStateHeading(settings)}</h3>
            <p>{getWebhookStatusCopy(settings)}</p>
            <dl>
              <div>
                <dt>Endpoint</dt>
                <dd>{getWebhookDeliveryLabel(settings)}</dd>
              </div>
              <div>
                <dt>Signing secret</dt>
                <dd>{getWebhookSecretLabel(settings)}</dd>
              </div>
              <div>
                <dt>Events</dt>
                <dd>{WEBHOOK_EVENT_LABEL}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>{formatWebhookDateTime(settings.updated_at)}</dd>
              </div>
            </dl>
          </aside>

          <form
            className="notifications-settings-form webhook-settings-form"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSave();
            }}
          >
            <fieldset className="notification-fieldset">
              <legend>Delivery</legend>
              <div className="notification-input-stack">
                <label className="notification-checkbox-row">
                  <input
                    type="checkbox"
                    checked={draftEnabled}
                    onChange={(event) => setDraftEnabled(event.target.checked)}
                  />
                  <span>
                    <strong>Enable webhook delivery</strong>
                    <small>Send released recommendations to your endpoint.</small>
                  </span>
                </label>

                <label className="notification-input-field">
                  <span>Webhook URL</span>
                  <input
                    autoCapitalize="none"
                    autoComplete="off"
                    className="notification-text-input"
                    inputMode="url"
                    maxLength={2048}
                    onChange={(event) => handleDraftUrlChange(event.target.value)}
                    placeholder="https://example.com/hook"
                    spellCheck={false}
                    type="url"
                    value={draftUrl}
                  />
                  <small>Use an absolute http or https URL.</small>
                </label>
              </div>
            </fieldset>

            <fieldset className="notification-fieldset">
              <legend>Signing</legend>
              <div className="notification-input-stack">
                <label className="notification-input-field">
                  <span>Signing secret</span>
                  <input
                    autoComplete="new-password"
                    className="notification-text-input"
                    disabled={clearSecret}
                    maxLength={2048}
                    onChange={(event) =>
                      handleDraftSecretChange(event.target.value)
                    }
                    placeholder={
                      settings.secret_configured
                        ? "Configured; enter a new value to replace"
                        : "Optional shared secret"
                    }
                    type="password"
                    value={draftSecret}
                  />
                  <small>
                    Adds timestamped HMAC headers when configured.
                  </small>
                </label>

                {settings.secret_configured ? (
                  <label className="notification-checkbox-row notification-checkbox-row--compact">
                    <input
                      type="checkbox"
                      checked={clearSecret}
                      onChange={(event) =>
                        handleClearSecretChange(event.target.checked)
                      }
                    />
                    <span>
                      <strong>Clear signing secret</strong>
                      <small>Keep webhook delivery without signed requests.</small>
                    </span>
                  </label>
                ) : null}
              </div>
            </fieldset>

            <div className="notification-action-bar">
              <button
                className="notification-primary-button"
                type="submit"
                disabled={isSaving}
              >
                {isSaving ? "Saving" : "Save webhook"}
                <Check aria-hidden="true" size={15} strokeWidth={1.8} />
              </button>
              <button
                className={
                  confirmDisconnect
                    ? "notification-danger-button is-confirming"
                    : "notification-danger-button"
                }
                type="button"
                onClick={() => void handleDisconnect()}
                disabled={isDisconnecting || !canDisconnect}
              >
                {confirmDisconnect
                  ? "Confirm disconnect webhook"
                  : "Disconnect webhook"}
                <Trash2 aria-hidden="true" size={15} strokeWidth={1.8} />
              </button>
            </div>

            {error ? (
              <p className="notification-form-message is-error" role="alert">
                {error}
              </p>
            ) : message ? (
              <p className="notification-form-message">{message}</p>
            ) : (
              <p className="notification-form-message">
                Event: {WEBHOOK_EVENT_LABEL}.
              </p>
            )}
          </form>
        </div>
      ) : null}
    </section>
  );
}
