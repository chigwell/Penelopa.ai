"use client";

import { NotificationsSkeleton } from "../../components/loading/Loading";

import { ArrowUpRight, RefreshCw } from "lucide-react";
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
        <a className="notification-manage-link" href="/dashboard/notifications">
          Manage
          <ArrowUpRight aria-hidden="true" size={14} strokeWidth={1.8} />
        </a>
      </div>

      <div className="notifications-compact-body">
        {isLoading && !settings ? (
          <NotificationsSkeleton compact />
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
              <span
                className={`notification-status-dot ${getWebhookStatusTone(settings)}`}
                aria-hidden="true"
              />
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
