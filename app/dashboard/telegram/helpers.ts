import type { TelegramNotificationStatus, TelegramNotificationLanguage, TelegramNotificationType, TelegramNotificationState } from "../../lib/api-types";
import { formatDateTime as formatSharedDateTime } from "../../lib/formatting";

export const LANGUAGE_OPTIONS: ReadonlyArray<{
  value: TelegramNotificationLanguage;
  label: string;
}> = [
  { value: "en", label: "English" },
  { value: "ru", label: "Russian" },
];

export const NOTIFICATION_TYPE_OPTIONS: ReadonlyArray<{
  value: TelegramNotificationType;
  label: string;
  description: string;
}> = [
  {
    value: "recommendation_created",
    label: "New recommendations",
    description: "When Penelopa creates a recommendation from your activity.",
  },
  {
    value: "recommendation_approved",
    label: "Approved recommendations",
    description: "When a recommendation is approved.",
  },
];

export function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "No active expiry";
  }

  return formatSharedDateTime(value, "No active expiry");
}

export function normalizeNotificationTypes(
  value: TelegramNotificationType[] | null | undefined,
) {
  if (!value) {
    return [];
  }

  return NOTIFICATION_TYPE_OPTIONS.filter((option) =>
    value.includes(option.value),
  ).map((option) => option.value);
}

export function getStatusLabel(status: TelegramNotificationStatus) {
  if (status === "CONNECTED") {
    return "Connected";
  }
  if (status === "PENDING") {
    return "Pending";
  }
  return "Disabled";
}

export function getStatusTone(settings: TelegramNotificationState) {
  if (settings.status === "CONNECTED" && settings.enabled) {
    return "is-connected";
  }
  if (settings.status === "PENDING") {
    return "is-pending";
  }
  return "is-disabled";
}

export function getDeliveryLabel(settings: TelegramNotificationState) {
  if (settings.telegram_username) {
    return settings.telegram_username.startsWith("@")
      ? settings.telegram_username
      : `@${settings.telegram_username}`;
  }

  if (settings.telegram_chat_id) {
    return `Chat ${settings.telegram_chat_id}`;
  }

  return "No Telegram chat connected";
}

export function getStatusCopy(settings: TelegramNotificationState) {
  if (settings.setup_available === false && settings.status !== "CONNECTED") {
    return "Telegram setup is temporarily unavailable.";
  }

  if (settings.status === "PENDING") {
    return "Open Telegram and start the bot to finish connecting.";
  }

  if (settings.status === "CONNECTED" && settings.enabled) {
    return "Notifications are active.";
  }

  if (settings.status === "CONNECTED") {
    return "Telegram is connected, but notifications are paused.";
  }

  return "Choose the events you want and connect Telegram.";
}

export function getStateLabel(settings: TelegramNotificationState) {
  if (settings.status === "DISABLED") {
    return "Disabled";
  }
  return settings.enabled ? "Enabled" : "Paused";
}

export function getStateHeading(settings: TelegramNotificationState) {
  if (settings.status === "DISABLED") {
    return "Notifications disabled";
  }
  return settings.enabled ? "Notifications enabled" : "Notifications paused";
}

export function getTypeSummary(types: TelegramNotificationType[]) {
  const labels = NOTIFICATION_TYPE_OPTIONS.filter((option) =>
    types.includes(option.value),
  ).map((option) => option.label);

  return labels.length ? labels.join(", ") : "No event types selected";
}

export function getExpiryTime(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

export function getPendingInstruction(value: string | null | undefined, now: number) {
  const expiresAt = formatDateTime(value);
  if (expiresAt === "No active expiry") {
    return "Start the bot from the active setup link.";
  }
  return `Start the bot before ${expiresAt}. ${getTimeRemainingLabel(value, now)}.`;
}

export function getTimeRemainingLabel(value: string | null | undefined, now: number) {
  const expiryTime = getExpiryTime(value);
  if (expiryTime === null) {
    return "No expiry time available";
  }

  const remainingSeconds = Math.max(0, Math.ceil((expiryTime - now) / 1000));
  if (remainingSeconds <= 0) {
    return "Link expired";
  }

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds.toString().padStart(2, "0")}s left`;
  }
  return `${seconds}s left`;
}

export function getLastCheckedLabel(value: number | null, now: number) {
  if (!value) {
    return "Checking now";
  }

  const elapsedSeconds = Math.max(0, Math.floor((now - value) / 1000));
  if (elapsedSeconds < 2) {
    return "Checked just now";
  }
  return `Last checked ${elapsedSeconds}s ago`;
}

export function isSetupAvailable(settings: TelegramNotificationState | null) {
  return settings?.setup_available !== false;
}

