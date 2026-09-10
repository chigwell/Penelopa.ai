"use client";

import { useWebhookSettings } from "./webhook/use-webhook-settings";
import { renderWebhookCompactSettings } from "./webhook/CompactSettings";
import { renderWebhookFullSettings } from "./webhook/FullSettings";

export type {
  RecommendationWebhookNotificationType,
  RecommendationWebhookState,
  RecommendationWebhookUpdate,
} from "../lib/api-types";

type ComponentMode = "compact" | "full";

export function WebhookNotificationsSettings({
  mode,
  onAuthExpired,
  token,
}: {
  mode: ComponentMode;
  onAuthExpired: () => void;
  token: string;
}) {
  const state = useWebhookSettings({ onAuthExpired, token });
  return mode === "compact"
    ? renderWebhookCompactSettings(state)
    : renderWebhookFullSettings(state);
}
