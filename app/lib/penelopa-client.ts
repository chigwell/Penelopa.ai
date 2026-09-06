"use client";
import { useEffect, useState } from "react";
import type { DesktopApiRequest, DesktopBridge } from "../../desktop/contracts";

export type ApiError = Error & { status: number };
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
export async function apiRequest<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  let status: number;
  let payload: unknown;
  if (isDesktop()) {
    const response = await window.penelopaDesktop!.request({ path: `/v1${path}`, method: (init.method || "GET") as DesktopApiRequest["method"],
      ...(init.body !== undefined ? { body: JSON.parse(String(init.body)) } : {}) });
    status = response.status; payload = response.data;
  } else {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`); headers.set("Accept", "application/json");
    if (init.body !== undefined) headers.set("Content-Type", "application/json");
    const response = await fetch(`https://api.penelopa.ai/v1${path}`, { ...init, headers });
    status = response.status;
    payload = response.status === 204 ? null : await response.json().catch(() => null);
  }
  if (status < 200 || status >= 300) {
    const detail = payload && typeof payload === "object" && "detail" in payload ? String(payload.detail) : "The request could not be completed.";
    throw Object.assign(new Error(detail), { status }) as ApiError;
  }
  return payload as T;
}
export const apiGet = apiRequest;
