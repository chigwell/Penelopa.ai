"use strict";

// Credentials remain owned by the main process; trust validation stays at IPC entry.
function createApiRequest({ validateRequest, net, getAuth, showPage }) {
  return async function apiRequest(request) {
    const validated = validateRequest(request);
    if (!getAuth().token)
      return {
        status: 401,
        data: { detail: "Reconnect your installed account from Connection." },
      };
    const accountToken = getAuth().token;
    try {
      const response = await net.fetch(validated.url, {
        method: validated.method,
        redirect: "error",
        credentials: "omit",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accountToken}`,
          ...(validated.body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
        },
        ...(validated.body === undefined
          ? {}
          : { body: JSON.stringify(validated.body) }),
        signal: AbortSignal.timeout(20_000),
      });
      let data = null;
      if (response.status !== 204) {
        const text = await response.text();
        if (text.length > 8_388_608) throw new Error("Response too large.");
        try {
          data = JSON.parse(text);
        } catch {}
      }
      if ([401, 403].includes(response.status) && getAuth().token === accountToken) {
        getAuth().signOut("Your installed account needs to be reconnected.");
        showPage("connection");
      }
      return { status: response.status, data };
    } catch {
      return {
        status: 503,
        data: {
          detail:
            "Penelopa is currently unreachable. Your local queue is safe. Try again when you are online.",
        },
      };
    }
  };
}

module.exports = { createApiRequest };
