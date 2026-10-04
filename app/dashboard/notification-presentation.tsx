import type { ReactNode } from "react";
import { ArrowUpRight, RefreshCw } from "lucide-react";

// Call these render helpers directly so the existing views retain their
// element identity when switching between compact and full settings.
export function renderNotificationManageLink() {
  return (
    <a className="notification-manage-link" href="/dashboard/notifications">
      Manage
      <ArrowUpRight aria-hidden="true" size={14} strokeWidth={1.8} />
    </a>
  );
}

export function renderNotificationLoadError(error: string, retry: () => void) {
  return (
    <div className="notifications-load-error" role="alert">
      <p>{error}</p>
      <button
        className="notification-secondary-button"
        type="button"
        onClick={retry}
      >
        Retry
        <RefreshCw aria-hidden="true" size={14} strokeWidth={1.8} />
      </button>
    </div>
  );
}

export function renderNotificationRefresh(refreshing: boolean, refresh: () => void) {
  return (
    <button
      className="notification-secondary-button"
      type="button"
      onClick={refresh}
      disabled={refreshing}
    >
      {refreshing ? "Refreshing" : "Refresh"}
      <RefreshCw aria-hidden="true" size={14} strokeWidth={1.8} />
    </button>
  );
}

export function renderNotificationIndicator(tone: string, spinning = false) {
  return spinning ? (
    <span className="notification-spinner" aria-hidden="true" />
  ) : (
    <span className={`notification-status-dot ${tone}`} aria-hidden="true" />
  );
}

export function renderNotificationFeedback(error: string, message: string, summary: ReactNode, id: string) {
  return (
    <p
      id={id}
      className={`notification-form-message${error ? " is-error" : ""}`}
      role={error ? "alert" : "status"}
      aria-live={error ? undefined : "polite"}
      aria-atomic={error ? undefined : true}
    >
      {error || message || summary}
    </p>
  );
}
