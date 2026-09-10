"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  RecommendationWebhookState,
  RecommendationWebhookUpdate,
} from "../../lib/api-types";
import { apiRequest, isApiError } from "../../lib/penelopa-client";
import {
  WEBHOOK_NOTIFICATION_TYPES,
  normalizeWebhookNotificationTypes,
  validateWebhookUrl,
} from "./helpers";

const SETTINGS_PATH = "/user/recommendation-webhook";

export function useWebhookSettings({
  onAuthExpired,
  token,
}: {
  onAuthExpired: () => void;
  token: string;
}) {
  const [settings, setSettings] = useState<RecommendationWebhookState | null>(
    null,
  );
  const [draftEnabled, setDraftEnabled] = useState(false);
  const [draftUrl, setDraftUrl] = useState("");
  const [draftSecret, setDraftSecret] = useState("");
  const [clearSecret, setClearSecret] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const settingsRef = useRef<RecommendationWebhookState | null>(null);
  const mounted = useRef(true);
  const activeToken = useRef(token);
  activeToken.current = token;
  const readVersion = useRef(0);
  const readController = useRef<AbortController | null>(null);
  const readInFlight = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      readVersion.current += 1;
      readController.current?.abort();
      readInFlight.current = false;
    };
  }, [token]);

  function requestIsCurrent() {
    return mounted.current && activeToken.current === token;
  }

  function cancelSettingsRead() {
    readVersion.current += 1;
    readController.current?.abort();
    readInFlight.current = false;
    setIsRefreshing(false);
  }

  const applySettings = useCallback((nextSettings: RecommendationWebhookState) => {
    const normalized = {
      ...nextSettings,
      notification_types: normalizeWebhookNotificationTypes(
        nextSettings.notification_types,
      ),
    };
    settingsRef.current = normalized;
    setSettings(normalized);
  }, []);

  const loadSettings = useCallback(
    async ({
      reason = "initial",
    }: {
      reason?: "initial" | "manual";
    } = {}) => {
      if (!mounted.current || activeToken.current !== token || readInFlight.current) {
        return;
      }
      const version = ++readVersion.current;
      const controller = new AbortController();
      readController.current = controller;
      readInFlight.current = true;
      const isCurrent = () =>
        mounted.current &&
        activeToken.current === token &&
        readVersion.current === version;

      if (reason === "manual") {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
        setError("");
      }

      try {
        const nextSettings =
          await apiRequest<RecommendationWebhookState | null>(
            SETTINGS_PATH,
            token,
            { signal: controller.signal },
          );
        if (!isCurrent()) return;
        if (!nextSettings) {
          throw new Error("Empty webhook settings response.");
        }
        setError((current) =>
          current === "Webhook settings could not be loaded." ? "" : current,
        );
        applySettings(nextSettings);
      } catch (caught) {
        if (!isCurrent() || controller.signal.aborted) return;
        if (
          isApiError(caught) &&
          (caught.status === 401 || caught.status === 403)
        ) {
          onAuthExpired();
          return;
        }
        setError("Webhook settings could not be loaded.");
      } finally {
        if (!isCurrent()) return;
        readInFlight.current = false;
        if (reason === "manual") {
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
    setDraftUrl(settings.url ?? "");
    setDraftSecret("");
    setClearSecret(false);
    setConfirmDisconnect(false);
  }, [settings]);

  function handleDraftUrlChange(value: string) {
    setDraftUrl(value);
    setConfirmDisconnect(false);
  }

  function handleDraftSecretChange(value: string) {
    setDraftSecret(value);
    if (value.trim()) {
      setClearSecret(false);
    }
    setConfirmDisconnect(false);
  }

  function handleClearSecretChange(value: boolean) {
    setClearSecret(value);
    if (value) {
      setDraftSecret("");
    }
    setConfirmDisconnect(false);
  }

  async function handleSave() {
    const trimmedUrl = draftUrl.trim();
    const validationError = validateWebhookUrl(trimmedUrl, draftEnabled);
    if (validationError) {
      setError(validationError);
      setMessage("");
      return false;
    }

    cancelSettingsRead();
    setIsSaving(true);
    setError("");
    setMessage("");

    const shouldClearSecret = Boolean(settingsRef.current?.secret_configured) && clearSecret;
    const nextSecret = shouldClearSecret ? "" : draftSecret.trim();
    const body: RecommendationWebhookUpdate = {
      clear_secret: shouldClearSecret,
      enabled: draftEnabled,
      notification_types: [...WEBHOOK_NOTIFICATION_TYPES],
      secret: nextSecret || null,
      url: trimmedUrl || null,
    };

    try {
      const updated = await apiRequest<RecommendationWebhookState | null>(
        SETTINGS_PATH,
        token,
        {
          body: JSON.stringify(body),
          method: "PATCH",
        },
      );

      if (!requestIsCurrent()) return false;
      if (updated) {
        applySettings(updated);
      } else {
        await loadSettings({ reason: "manual" });
      }
      if (!requestIsCurrent()) return false;
      setMessage("Webhook settings saved.");
      return true;
    } catch (caught) {
      if (!requestIsCurrent()) return false;
      if (
        isApiError(caught) &&
        (caught.status === 401 || caught.status === 403)
      ) {
        onAuthExpired();
        return false;
      }
      setError(
        isApiError(caught) && caught.status === 422
          ? caught.message
          : "Webhook settings could not be saved.",
      );
      return false;
    } finally {
      if (requestIsCurrent()) setIsSaving(false);
    }
  }

  async function handleDisconnect() {
    if (!confirmDisconnect) {
      setConfirmDisconnect(true);
      return;
    }

    cancelSettingsRead();
    setIsDisconnecting(true);
    setError("");
    setMessage("");

    try {
      const updated = await apiRequest<RecommendationWebhookState | null>(
        SETTINGS_PATH,
        token,
        { method: "DELETE" },
      );

      if (!requestIsCurrent()) return false;
      if (updated) {
        applySettings(updated);
      } else {
        await loadSettings({ reason: "manual" });
      }
      if (!requestIsCurrent()) return false;
      setMessage("Webhook disconnected.");
      return true;
    } catch (caught) {
      if (!requestIsCurrent()) return false;
      if (
        isApiError(caught) &&
        (caught.status === 401 || caught.status === 403)
      ) {
        onAuthExpired();
        return false;
      }
      setError("Webhook could not be disconnected.");
      return false;
    } finally {
      if (requestIsCurrent()) setIsDisconnecting(false);
    }
  }

  return {
    settings, draftEnabled, setDraftEnabled, draftUrl, draftSecret, clearSecret,
    isLoading, isRefreshing, isSaving, isDisconnecting, confirmDisconnect,
    error, message, loadSettings, handleDraftUrlChange, handleDraftSecretChange,
    handleClearSecretChange, handleSave, handleDisconnect,
  };
}

export type WebhookSettings = ReturnType<typeof useWebhookSettings>;
