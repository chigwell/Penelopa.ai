"use client";

import { NotificationsSkeleton } from "../../components/loading/Loading";

import { Check, Trash2 } from "lucide-react";
import {
  renderNotificationFeedback,
  renderNotificationIndicator,
  renderNotificationLoadError,
  renderNotificationRefresh,
} from "../notification-presentation";
import {
  WEBHOOK_EVENT_LABEL,
  formatWebhookDateTime,
  getWebhookDeliveryLabel,
  getWebhookSecretLabel,
  getWebhookStateHeading,
  getWebhookStatusCopy,
  getWebhookStatusLabel,
  getWebhookStatusTone,
  validateWebhookUrl,
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
  const urlInvalid = Boolean(error && error === validateWebhookUrl(draftUrl, draftEnabled));

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
          renderNotificationRefresh(isRefreshing, () => void loadSettings({ reason: "manual" }))
        ) : null}
      </div>

      {isLoading && !settings ? (
        <NotificationsSkeleton />
      ) : error && !settings ? (
        renderNotificationLoadError(error, () => void loadSettings({ reason: "initial" }))
      ) : settings ? (
        <div className="notifications-settings-grid">
          <aside className="notifications-status-card">
            {renderNotificationIndicator(getWebhookStatusTone(settings))}
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
            aria-describedby="webhook-settings-feedback"
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
                    aria-invalid={urlInvalid || undefined}
                    aria-describedby={`webhook-url-help${urlInvalid ? " webhook-settings-feedback" : ""}`}
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
                  <small id="webhook-url-help">Use an absolute http or https URL.</small>
                </label>
              </div>
            </fieldset>

            <fieldset className="notification-fieldset">
              <legend>Signing</legend>
              <div className="notification-input-stack">
                <label className="notification-input-field">
                  <span>Signing secret</span>
                  <input
                    aria-describedby="webhook-signing-help"
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
                  <small id="webhook-signing-help">
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

            {renderNotificationFeedback(error, message, <>Event: {WEBHOOK_EVENT_LABEL}.</>, "webhook-settings-feedback")}
          </form>
        </div>
      ) : null}
    </section>
  );
}
