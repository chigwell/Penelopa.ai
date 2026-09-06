"use client";

import { useTelegramSettings } from "./telegram/use-telegram-settings";
import { renderTelegramCompactSettings } from "./telegram/CompactSettings";
import { renderTelegramFullSettings } from "./telegram/FullSettings";

export type {
  TelegramNotificationStatus,
  TelegramNotificationLanguage,
  TelegramNotificationType,
  TelegramNotificationState,
} from "../lib/api-types";

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
  const state = useTelegramSettings({ onAuthExpired, token });
  // Keep the same section reconciliation when the display mode changes.
  return mode === "compact"
    ? renderTelegramCompactSettings(state)
    : renderTelegramFullSettings(state);
}
