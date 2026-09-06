"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TelegramNotificationLanguage, TelegramNotificationType, TelegramNotificationState, TelegramSetupLinkResponse } from "../../lib/api-types";
import { apiRequest, isApiError } from "../../lib/penelopa-client";
import { normalizeNotificationTypes, getExpiryTime, isSetupAvailable, getTypeSummary, getLastCheckedLabel, getTimeRemainingLabel } from "./helpers";

const SETTINGS_PATH = "/user/telegram-notifications";
const POLL_INTERVAL_MS = 2000;

export function useTelegramSettings({ onAuthExpired, token }: {
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
  const [isPolling, setIsPolling] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const settingsRef = useRef<TelegramNotificationState | null>(null);

  const applySettings = useCallback(
    (
      nextSettings: TelegramNotificationState,
      options: { announceConnection?: boolean; recordCheck?: boolean } = {},
    ) => {
      const previousStatus = settingsRef.current?.status;
      settingsRef.current = nextSettings;
      setSettings(nextSettings);
      if (options.recordCheck) {
        const checkedAt = Date.now();
        setLastCheckedAt(checkedAt);
        setNow(checkedAt);
      }
      if (nextSettings.status === "CONNECTED") {
        setSetupLink(null);
      }
      if (
        options.announceConnection &&
        previousStatus === "PENDING" &&
        nextSettings.status === "CONNECTED"
      ) {
        setError("");
        setMessage("Telegram connected. Notifications are active.");
      }
    },
    [],
  );

  const loadSettings = useCallback(
    async ({
      reason = "initial",
    }: {
      reason?: "initial" | "manual" | "poll";
    } = {}) => {
      if (reason === "poll") {
        setIsPolling(true);
      } else if (reason === "manual") {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
        setError("");
      }

      try {
        const nextSettings = await apiRequest<TelegramNotificationState | null>(
          SETTINGS_PATH,
          token,
        );
        if (!nextSettings) {
          throw new Error("Empty Telegram notification settings response.");
        }
        applySettings(nextSettings, {
          announceConnection: reason !== "initial",
          recordCheck: true,
        });
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
        if (reason === "poll") {
          setIsPolling(false);
        } else if (reason === "manual") {
          setIsRefreshing(false);
        } else {
          setIsLoading(false);
        }
      }
    },
    [applySettings, onAuthExpired, token],
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

  const pendingExpiryTime = getExpiryTime(settings?.link_expires_at);
  const pendingLinkExpired =
    settings?.status === "PENDING" &&
    pendingExpiryTime !== null &&
    pendingExpiryTime <= now;
  const pendingSetupUnavailable =
    settings?.status === "PENDING" && !isSetupAvailable(settings);
  const shouldPollConnection =
    settings?.status === "PENDING" &&
    !pendingLinkExpired &&
    !pendingSetupUnavailable;

  useEffect(() => {
    if (!shouldPollConnection) {
      return;
    }

    void loadSettings({ reason: "poll" });
    const interval = window.setInterval(() => {
      const expiryTime = getExpiryTime(settingsRef.current?.link_expires_at);
      if (expiryTime !== null && expiryTime <= Date.now()) {
        setNow(Date.now());
        window.clearInterval(interval);
        return;
      }
      void loadSettings({ reason: "poll" });
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [loadSettings, shouldPollConnection]);

  useEffect(() => {
    if (settings?.status !== "PENDING") {
      return;
    }

    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [settings?.link_expires_at, settings?.status]);

  useEffect(() => {
    if (!shouldPollConnection) {
      return;
    }

    function refreshPendingState() {
      if (document.visibilityState === "visible") {
        void loadSettings({ reason: "poll" });
      }
    }

    window.addEventListener("focus", refreshPendingState);
    document.addEventListener("visibilitychange", refreshPendingState);
    return () => {
      window.removeEventListener("focus", refreshPendingState);
      document.removeEventListener("visibilitychange", refreshPendingState);
    };
  }, [loadSettings, shouldPollConnection]);

  const selectedTypesSummary = useMemo(
    () => getTypeSummary(draftTypes),
    [draftTypes],
  );
  const lastCheckedLabel = getLastCheckedLabel(lastCheckedAt, now);
  const pendingTimeRemaining = getTimeRemainingLabel(
    settings?.link_expires_at,
    now,
  );

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
      const updated = await apiRequest<TelegramNotificationState | null>(
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
        applySettings(updated);
      } else {
        await loadSettings({ reason: "manual" });
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
    if (!isSetupAvailable(settings)) {
      setError(
        "Telegram setup is temporarily unavailable. Ask an administrator to configure the bot.",
      );
      return;
    }

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

      const link = await apiRequest<TelegramSetupLinkResponse | null>(
        `${SETTINGS_PATH}/link`,
        token,
        { method: "POST" },
      );

      if (!link) {
        throw new Error("Empty Telegram setup link response.");
      }

      setSetupLink(link.deep_link_url);
      const current = settingsRef.current;
      applySettings({
        enabled: true,
        language: draftLanguage,
        link_expires_at: link.expires_at,
        notification_types: normalizeNotificationTypes(draftTypes),
        setup_available: current?.setup_available ?? true,
        setup_unavailable_reason: current?.setup_unavailable_reason ?? null,
        status: link.status,
        telegram_chat_id: current?.telegram_chat_id ?? null,
        telegram_username: current?.telegram_username ?? null,
      });
      setLastCheckedAt(null);
      setMessage("Open Telegram. We will update this page automatically.");
    } catch (caught) {
      if (
        isApiError(caught) &&
        (caught.status === 401 || caught.status === 403)
      ) {
        onAuthExpired();
        return;
      }
      if (isApiError(caught) && caught.status === 503) {
        setError(caught.message);
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
      await apiRequest<void | null>(`${SETTINGS_PATH}/connection`, token, {
        method: "DELETE",
      });
      const nextSettings: TelegramNotificationState = {
        enabled: false,
        language: draftLanguage,
        link_expires_at: null,
        notification_types: normalizeNotificationTypes(draftTypes),
        setup_available: settingsRef.current?.setup_available ?? true,
        setup_unavailable_reason:
          settingsRef.current?.setup_unavailable_reason ?? null,
        status: "DISABLED",
        telegram_chat_id: null,
        telegram_username: null,
      };
      setSetupLink(null);
      applySettings(nextSettings);
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

  return {
    settings, draftLanguage, setDraftLanguage, draftTypes,
    setupLink, isLoading, isRefreshing, isPolling,
    isSaving, isLinking, isDisconnecting, confirmDisconnect,
    now, error, message, loadSettings,
    pendingLinkExpired, pendingSetupUnavailable, shouldPollConnection, selectedTypesSummary,
    lastCheckedLabel, pendingTimeRemaining, handleToggleType, handleSave,
    handleSetEnabled, handleCreateLink, handleDisconnect,
  };
}

export type TelegramSettings = ReturnType<typeof useTelegramSettings>;
