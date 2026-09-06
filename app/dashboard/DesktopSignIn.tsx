"use client";
import { isDesktop } from "../lib/penelopa-client";

export function DesktopSignIn() {
  if (!isDesktop()) return null;
  return <div className="token-form">
    <p>Reconnect the account installed on this computer from Connection settings.</p>
    <button type="button" className="token-submit" onClick={() => void window.penelopaDesktop!.openConnection()}>
      Open Connection
    </button>
  </div>;
}
