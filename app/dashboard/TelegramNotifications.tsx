"use client";

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
import { useCallback, useEffect, useMemo, useState } from "react";

export type TelegramNotificationStatus = "DISABLED" | "PENDING" | "CONNECTED";
export type TelegramNotificationLanguage = "ru" | "en";
export type TelegramNotificationType =
  | "recommendation_created"
  | "recommendation_approved";

export type TelegramNotificationState = {
  enabled: boolean;
  status: TelegramNotificationStatus;
  language: TelegramNotificationLanguage;
  notification_types: TelegramNotificationType[];
  telegram_username?: string | null;
  telegram_chat_id?: string | number | null;
  link_expires_at?: string | null;
};

type TelegramSetupLinkResponse = {
  deep_link_url: string;
  expires_at: string;
  status: "PENDING";
};

type ApiError = Error & { status: number };
type ComponentMode = "compact" | "full";

const API_BASE = "https://api.penelopa.ai/v1";
const SETTINGS_PATH = "/user/telegram-notifications";
const POLL_INTERVAL_MS = 5000;

const LANGUAGE_OPTIONS: ReadonlyArray<{
  value: TelegramNotificationLanguage;
  label: string;
}> = [
  { value: "en", label: "English" },
  { value: "ru", label: "Russian" },
];

const NOTIFICATION_TYPE_OPTIONS: ReadonlyArray<{
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

function isApiError(error: unknown): error is ApiError {
  return (
    error instanceof Error &&
    "status" in error &&
    typeof (error as ApiError).status === "number"
  );
}

async function telegramApi<T>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<T | null> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set("Authorization", `Bearer ${token}`);

  if (init.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { detail?: string }
      | null;
    const error = new Error(
      payload?.detail || "Telegram notification settings are unavailable.",
    ) as ApiError;
    error.status = response.status;
    throw error;
  }

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  if (!text) {
    return null;
  }

  return JSON.parse(text) as T;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "No active expiry";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "No active expiry";
  }

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function normalizeNotificationTypes(
  value: TelegramNotificationType[] | null | undefined,
) {
  if (!value) {
    return [];
  }

  return NOTIFICATION_TYPE_OPTIONS.filter((option) =>
    value.includes(option.value),
  ).map((option) => option.value);
}

function getStatusLabel(status: TelegramNotificationStatus) {
  if (status === "CONNECTED") {
    return "Connected";
  }
  if (status === "PENDING") {
    return "Pending";
  }
  return "Disabled";
}

function getStatusTone(settings: TelegramNotificationState) {
  if (settings.status === "CONNECTED" && settings.enabled) {
    return "is-connected";
  }
  if (settings.status === "PENDING") {
    return "is-pending";
  }
  return "is-disabled";
}

function getDeliveryLabel(settings: TelegramNotificationState) {
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

function getStatusCopy(settings: TelegramNotificationState) {
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

function getStateLabel(settings: TelegramNotificationState) {
  if (settings.status === "DISABLED") {
    return "Disabled";
  }
  return settings.enabled ? "Enabled" : "Paused";
}

function getStateHeading(settings: TelegramNotificationState) {
  if (settings.status === "DISABLED") {
    return "Notifications disabled";
  }
  return settings.enabled ? "Notifications enabled" : "Notifications paused";
}

function getTypeSummary(types: TelegramNotificationType[]) {
  const labels = NOTIFICATION_TYPE_OPTIONS.filter((option) =>
    types.includes(option.value),
  ).map((option) => option.label);

  return labels.length ? labels.join(", ") : "No event types selected";
}

function getExpiryTime(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function getPendingInstruction(value: string | null | undefined) {
  const expiresAt = formatDateTime(value);
  if (expiresAt === "No active expiry") {
    return "Start the bot from the active setup link.";
  }
  return `Start the bot before ${expiresAt}.`;
}

export function TelegramNotificationsSettings({
  mode,
  onAuthExpired,
  token,
}: {
  mode: ComponentMode;
  onAuthExpired: () => void;
  token: string;
}) {
  const [settings, setSettings] = useState<TelegramNotificationState | null>(
    null,
  );
  const [draftEnabled, setDraftEnabled] = useState(false);
  const [draftLanguage, setDraftLanguage] =
    useState<TelegramNotificationLanguage>("en");
  const [draftTypes, setDraftTypes] = useState<TelegramNotificationType[]>([]);
  const [setupLink, setSetupLink] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadSettings = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (silent) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
        setError("");
      }

      try {
        const nextSettings = await telegramApi<TelegramNotificationState>(
          SETTINGS_PATH,
          token,
        );
        if (!nextSettings) {
          throw new Error("Empty Telegram notification settings response.");
        }
        setSettings(nextSettings);
        if (nextSettings.status === "CONNECTED") {
          setSetupLink(null);
        }
      } catch (caught) {
        if (
          isApiError(caught) &&
          (caught.status === 401 || caught.status === 403)
        ) {
          onAuthExpired();
          return;
        }
        setError("Telegram notification settings could not be loaded.");
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [onAuthExpired, token],
  );

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (!settings) {
      return;
    }

    setDraftEnabled(settings.enabled);
    setDraftLanguage(settings.language);
    setDraftTypes(normalizeNotificationTypes(settings.notification_types));
    if (settings.status !== "PENDING") {
      setSetupLink(null);
    }
    setConfirmDisconnect(false);
  }, [settings]);

  useEffect(() => {
    if (settings?.status !== "PENDING") {
      return;
    }

    const interval = window.setInterval(() => {
      const expiryTime = getExpiryTime(settings.link_expires_at);
      if (expiryTime !== null && expiryTime <= Date.now()) {
        window.clearInterval(interval);
        return;
      }
      void loadSettings({ silent: true });
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [loadSettings, settings?.link_expires_at, settings?.status]);

  const selectedTypesSummary = useMemo(
    () => getTypeSummary(draftTypes),
    [draftTypes],
  );

  const pendingLinkExpired =
    settings?.status === "PENDING" &&
    getExpiryTime(settings.link_expires_at) !== null &&
    getExpiryTime(settings.link_expires_at)! <= Date.now();

  async function updatePreferences(
    enabled: boolean,
    successMessage: string,
    options: { quiet?: boolean } = {},
  ) {
    const nextTypes = normalizeNotificationTypes(draftTypes);
    if (enabled && nextTypes.length === 0) {
      setError("Choose at least one notification type.");
      return null;
    }

    if (!options.quiet) {
      setIsSaving(true);
      setError("");
      setMessage("");
    }

    try {
      const updated = await telegramApi<TelegramNotificationState>(
        SETTINGS_PATH,
        token,
        {
          body: JSON.stringify({
            enabled,
            language: draftLanguage,
            notification_types: nextTypes,
          }),
          method: "PATCH",
        },
      );

      if (updated) {
        setSettings(updated);
      } else {
        await loadSettings({ silent: true });
      }

      if (!options.quiet) {
        setMessage(successMessage);
      }

      return true;
    } catch (caught) {
      if (
        isApiError(caught) &&
        (caught.status === 401 || caught.status === 403)
      ) {
        onAuthExpired();
        return false;
      }
      setError("Telegram notification preferences could not be saved.");
      return false;
    } finally {
      if (!options.quiet) {
        setIsSaving(false);
      }
    }
  }

  async function handleSave() {
    await updatePreferences(draftEnabled, "Notification preferences saved.");
  }

  async function handleSetEnabled(enabled: boolean) {
    const previousEnabled = draftEnabled;
    setDraftEnabled(enabled);
    const saved = await updatePreferences(
      enabled,
      enabled ? "Notifications enabled." : "Notifications paused.",
    );
    if (!saved) {
      setDraftEnabled(previousEnabled);
    }
  }

  function handleToggleType(type: TelegramNotificationType) {
    setDraftTypes((current) => {
      const next = current.includes(type)
        ? current.filter((item) => item !== type)
        : [...current, type];
      return normalizeNotificationTypes(next);
    });
  }

  async function handleCreateLink() {
    if (normalizeNotificationTypes(draftTypes).length === 0) {
      setError("Choose at least one notification type.");
      return;
    }

    setIsLinking(true);
    setError("");
    setMessage("");

    try {
      const saved = await updatePreferences(true, "", { quiet: true });
      if (!saved) {
        return;
      }

      const link = await telegramApi<TelegramSetupLinkResponse>(
        `${SETTINGS_PATH}/link`,
        token,
        { method: "POST" },
      );

      if (!link) {
        throw new Error("Empty Telegram setup link response.");
      }

      setSetupLink(link.deep_link_url);
      setSettings((current) => ({
        enabled: true,
        language: draftLanguage,
        link_expires_at: link.expires_at,
        notification_types: normalizeNotificationTypes(draftTypes),
        status: link.status,
        telegram_chat_id: current?.telegram_chat_id ?? null,
        telegram_username: current?.telegram_username ?? null,
      }));
      setMessage("Open Telegram to finish the connection.");
    } catch (caught) {
      if (
        isApiError(caught) &&
        (caught.status === 401 || caught.status === 403)
      ) {
        onAuthExpired();
        return;
      }
      setError("Telegram setup link could not be generated.");
    } finally {
      setIsLinking(false);
    }
  }

  async function handleDisconnect() {
    if (!confirmDisconnect) {
      setConfirmDisconnect(true);
      return;
    }

    setIsDisconnecting(true);
    setError("");
    setMessage("");

    try {
      await telegramApi<void>(`${SETTINGS_PATH}/connection`, token, {
        method: "DELETE",
      });
      const nextSettings: TelegramNotificationState = {
        enabled: false,
        language: draftLanguage,
        link_expires_at: null,
        notification_types: normalizeNotificationTypes(draftTypes),
        status: "DISABLED",
        telegram_chat_id: null,
        telegram_username: null,
      };
      setSetupLink(null);
      setSettings(nextSettings);
      setMessage("Telegram disconnected.");
    } catch (caught) {
      if (
        isApiError(caught) &&
        (caught.status === 401 || caught.status === 403)
      ) {
        onAuthExpired();
        return;
      }
      setError("Telegram could not be disconnected.");
    } finally {
      setIsDisconnecting(false);
    }
  }

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
                onClick={() => void loadSettings()}
              >
                Retry
                <RefreshCw aria-hidden="true" size={14} strokeWidth={1.8} />
              </button>
            </div>
          ) : settings ? (
            <>
              <div className="notifications-status-line">
                <span
                  className={`notification-status-dot ${getStatusTone(settings)}`}
                  aria-hidden="true"
                />
                <strong>{getStatusLabel(settings.status)}</strong>
                <span>{getStatusCopy(settings)}</span>
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
            onClick={() => void loadSettings()}
            disabled={isRefreshing}
          >
            Refresh
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
            onClick={() => void loadSettings()}
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
                  <h3>Open Telegram</h3>
                  <p>{getPendingInstruction(settings.link_expires_at)}</p>
                  {pendingLinkExpired ? (
                    <p className="notification-box-warning">
                      This setup link has expired. Generate a new link.
                    </p>
                  ) : null}
                </div>
                <div className="notification-box-actions">
                  {setupLink && !pendingLinkExpired ? (
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
                    disabled={isLinking}
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
                  <h3>Connect Telegram</h3>
                  <p>Generate a setup link, open it, and start the bot.</p>
                </div>
                <div className="notification-box-actions">
                  <button
                    className="notification-primary-button"
                    type="button"
                    onClick={() => void handleCreateLink()}
                    disabled={isLinking}
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
