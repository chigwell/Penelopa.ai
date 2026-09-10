import type {
  RecommendationWebhookNotificationType,
  RecommendationWebhookState,
} from "../../lib/api-types";
import { formatDateTime as formatSharedDateTime } from "../../lib/formatting";

export const WEBHOOK_NOTIFICATION_TYPE: RecommendationWebhookNotificationType =
  "recommendation_approved";
export const WEBHOOK_NOTIFICATION_TYPES: RecommendationWebhookNotificationType[] =
  [WEBHOOK_NOTIFICATION_TYPE];
export const WEBHOOK_EVENT_LABEL = "Released recommendations";

export function formatWebhookDateTime(value: string | null | undefined) {
  if (!value) {
    return "Never";
  }
  return formatSharedDateTime(value, "Never");
}

export function normalizeWebhookNotificationTypes(
  value: RecommendationWebhookNotificationType[] | null | undefined,
) {
  return value?.includes(WEBHOOK_NOTIFICATION_TYPE)
    ? [WEBHOOK_NOTIFICATION_TYPE]
    : [WEBHOOK_NOTIFICATION_TYPE];
}

export function getWebhookStatusTone(settings: RecommendationWebhookState) {
  return settings.enabled && settings.url ? "is-connected" : "is-disabled";
}

export function getWebhookStatusLabel(settings: RecommendationWebhookState) {
  return settings.enabled && settings.url ? "Enabled" : "Disabled";
}

export function getWebhookStateHeading(settings: RecommendationWebhookState) {
  if (settings.enabled && settings.url) {
    return "Webhook delivery enabled";
  }
  if (settings.url) {
    return "Webhook delivery paused";
  }
  return "Webhook not configured";
}

export function getWebhookStatusCopy(settings: RecommendationWebhookState) {
  if (settings.enabled && settings.url) {
    return "Released recommendations are delivered to your webhook endpoint.";
  }
  if (settings.url) {
    return "Webhook endpoint is saved, but delivery is paused.";
  }
  return "Add an endpoint to receive released recommendation alerts.";
}

export function getWebhookDeliveryLabel(settings: RecommendationWebhookState) {
  return settings.url || "No webhook URL configured";
}

export function getWebhookSecretLabel(settings: RecommendationWebhookState) {
  return settings.secret_configured ? "Configured" : "Not configured";
}

export function validateWebhookUrl(value: string, enabled: boolean) {
  const trimmed = value.trim();
  if (!trimmed) {
    return enabled
      ? "Webhook URL is required when webhook delivery is enabled."
      : "";
  }
  if (trimmed.length > 2048) {
    return "Webhook URL must be 2048 characters or fewer.";
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "Webhook URL must be an absolute http or https URL.";
  }

  if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) {
    return "Webhook URL must be an absolute http or https URL.";
  }
  if (parsed.username || parsed.password) {
    return "Webhook URL must not include username or password.";
  }
  if (parsed.hash) {
    return "Webhook URL must not include a fragment.";
  }
  return "";
}
