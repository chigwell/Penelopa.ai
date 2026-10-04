"use client";

import { NotificationsSkeleton } from "../../components/loading/Loading";

import {
  renderNotificationIndicator,
  renderNotificationLoadError,
  renderNotificationManageLink,
} from "../notification-presentation";
import {
  WEBHOOK_EVENT_LABEL,
  getWebhookDeliveryLabel,
  getWebhookSecretLabel,
  getWebhookStatusCopy,
  getWebhookStatusLabel,
  getWebhookStatusTone,
} from "./helpers";
import type { WebhookSettings } from "./use-webhook-settings";

export function renderWebhookCompactSettings(state: WebhookSettings) {
  const { settings, isLoading, error, loadSettings } = state;

  return (
    <section
      className="notifications-panel notifications-panel--compact"
      aria-labelledby="webhook-notifications-title"
      aria-busy={isLoading}
    >
      <div className="panel-topline notifications-topline">
        <div>
          <p className="eyebrow">Webhooks</p>
          <h2 id="webhook-notifications-title">Webhook delivery</h2>
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
              {renderNotificationIndicator(getWebhookStatusTone(settings))}
              <strong>{getWebhookStatusLabel(settings)}</strong>
              <span>{getWebhookStatusCopy(settings)}</span>
            </div>
            <div className="notifications-summary-grid">
              <article>
                <span>Endpoint</span>
                <strong>{getWebhookDeliveryLabel(settings)}</strong>
              </article>
              <article>
                <span>Secret</span>
                <strong>{getWebhookSecretLabel(settings)}</strong>
              </article>
              <article>
                <span>Events</span>
                <strong>{WEBHOOK_EVENT_LABEL}</strong>
              </article>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
