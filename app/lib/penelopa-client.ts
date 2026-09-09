"use client";
import { useEffect, useState } from "react";
import type { DesktopApiRequest, DesktopBridge } from "../../desktop/contracts";

export type ApiError = Error & { status: number; code?: string; details?: unknown };
export function isApiError(error: unknown): error is ApiError {
  return (
    error instanceof Error &&
    "status" in error &&
    typeof (error as ApiError).status === "number"
  );
}
export type { DesktopAuthState, DesktopApiRequest, DesktopBridge } from "../../desktop/contracts";
declare global { interface Window { penelopaDesktop?: DesktopBridge } }

const TOKEN_STORAGE_KEY = "penelopa-api-token";
// A compatibility handle for the shared UI. This is never a bearer token and
// is never sent over HTTP; only the main process owns desktop credentials.
const DESKTOP_SESSION = "penelopa:installed-session";
export function isDesktop() { return typeof window !== "undefined" && window.penelopaDesktop?.version === 1; }
export function hasTranscriptSupport() {
  return !isDesktop() || window.penelopaDesktop?.capabilities?.transcriptRead === true;
}
export function useDesktop() {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => { setDesktop(isDesktop()); }, []);
  return desktop;
}
export function readStoredToken(): string | null {
  if (isDesktop()) return DESKTOP_SESSION;
  try { return window.localStorage.getItem(TOKEN_STORAGE_KEY)?.trim() || null; } catch { return null; }
}
export function storeToken(value: string) {
  if (isDesktop()) return;
  try { window.localStorage.setItem(TOKEN_STORAGE_KEY, value); } catch { /* session remains usable */ }
}
export function clearStoredToken() {
  if (isDesktop()) { void window.penelopaDesktop!.auth.signOut().catch(() => {}); return; }
  try { window.localStorage.removeItem(TOKEN_STORAGE_KEY); } catch { /* UI still locks */ }
}
export function consumeTokenFromHash() {
  if (isDesktop()) return null;
  try {
    const token = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token")?.trim() || null;
    if (token) window.history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}`);
    return token;
  } catch { return null; }
}
async function versionedRequest<T>(version: "v1" | "v2", path: string, token: string, init: RequestInit): Promise<T> {
  let status: number;
  let payload: unknown;
  if (isDesktop()) {
    const response = await window.penelopaDesktop!.request({ path: `/${version}${path}`, method: (init.method || "GET") as DesktopApiRequest["method"],
      ...(init.body !== undefined ? { body: JSON.parse(String(init.body)) } : {}) });
    status = response.status; payload = response.data;
  } else {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`); headers.set("Accept", "application/json");
    if (init.body !== undefined) headers.set("Content-Type", "application/json");
    const response = await fetch(`https://api.penelopa.ai/${version}${path}`, { ...init, headers });
    status = response.status;
    payload = response.status === 204 ? null : await response.json().catch(() => null);
  }
  if (status < 200 || status >= 300) {
    const responseData = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
    const detail = responseData?.detail;
    const details = detail && typeof detail === "object" ? detail as Record<string, unknown> : responseData;
    const message = version === "v2" && details && typeof details.message === "string"
      ? details.message
      : version === "v2" && detail !== null && typeof detail === "object" ? "The request could not be completed."
      : detail !== undefined ? String(detail) : "The request could not be completed.";
    const code = typeof details?.code === "string" ? details.code : undefined;
    throw Object.assign(new Error(message), { status, ...(code ? { code } : {}), ...(details ? { details } : {}) }) as ApiError;
  }
  return payload as T;
}
export function apiRequest<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  return versionedRequest<T>("v1", path, token, init);
}
export function apiV2Get<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  if (!/^\/(user-read|process)\//.test(path) || /%2f|%5c|\\|\.\./i.test(path.split("?")[0]) || path.includes("#") || (init.method && init.method !== "GET") || init.body !== undefined) {
    return Promise.reject(Object.assign(new Error("Invalid transcript read request."), { status: 400, code: "invalid_request" }));
  }
  if (!hasTranscriptSupport()) {
    return Promise.reject(Object.assign(new Error("Update the app to explore your transcripts."), { status: 426, code: "desktop_update_required" }));
  }
  return versionedRequest<T>("v2", path, token, { ...init, method: "GET" });
}
export const apiGet = apiRequest;
