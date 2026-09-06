const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { transformSync, buildSync } = require("esbuild");

// Characterize the original private helpers before extracting them. The
// assertions stay fixed when this loader switches to the shared modules.
function privateHelpers(relativePath, componentMarker, names, globals = {}) {
  const file = path.join(__dirname, relativePath);
  const original = fs.readFileSync(file, "utf8").split(componentMarker)[0];
  const declarations = original.replace(/^import[\s\S]*?from ["'][^"']+["'];$/gm, "");
  const source = transformSync(`${declarations}\nexport { ${names.join(", ")} };`, { loader: "ts", format: "cjs" }).code;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, Intl, Date, ...globals });
  return module.exports;
}

function sharedHelpers(relativePath, globals = {}) {
  const source = buildSync({ entryPoints: [path.join(__dirname, relativePath)], bundle: true,
    platform: "node", format: "cjs", write: false }).outputFiles[0].text;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, Intl, Date, ...globals });
  return module.exports;
}

const dashboard = sharedHelpers("formatting.ts");
const home = { ...dashboard, formatMetric: dashboard.formatPublicMetric };
const telegram = privateHelpers("../dashboard/TelegramNotifications.tsx", "export function TelegramNotificationsSettings", [
  "formatDateTime", "normalizeNotificationTypes", "getStatusLabel", "getStatusTone", "getDeliveryLabel", "getStatusCopy",
  "getStateLabel", "getStateHeading", "getTypeSummary", "getExpiryTime", "getPendingInstruction", "getTimeRemainingLabel", "getLastCheckedLabel", "isSetupAvailable",
], { formatSharedDateTime: dashboard.formatDateTime });

test("homepage and dashboard preserve distinct placeholders and metric thresholds", () => {
  assert.equal(home.formatMetric(undefined), "...");
  assert.equal(dashboard.formatMetric(undefined), "—");
  assert.equal(dashboard.formatMetric(null), "—");
  for (const [value, label] of [[0, "0"], [99999, "99,999"], [100000, "100K"], [125100, "125.1K"], [999.6, "1,000"]]) {
    assert.equal(home.formatMetric(value), label);
    assert.equal(dashboard.formatMetric(value), label);
  }
  assert.equal(home.formatStars(undefined), "... stars");
  assert.equal(home.formatStars(1), "1 star");
  assert.equal(home.formatStars(2), "2 stars");
  assert.equal(dashboard.formatDelta(undefined), "— / 24h");
  assert.equal(dashboard.formatDelta(0), "+0 / 24h");
  assert.equal(dashboard.formatDelta(-12), "+-12 / 24h");
});

test("date labels retain route-specific missing and invalid values", () => {
  assert.equal(home.formatGeneratedAt(undefined), "Updating");
  assert.equal(home.formatGeneratedAt("invalid"), "Live");
  assert.equal(dashboard.formatDateTime("invalid"), "—");
  assert.equal(dashboard.formatDateTime(""), "—");
  for (const value of [undefined, null, "", "invalid"]) {
    assert.equal(telegram.formatDateTime(value), "No active expiry");
  }
  assert.equal(dashboard.formatDay("2026-09-06"), "Sep 6");
  assert.equal(telegram.formatDateTime("2026-09-06T12:34:00Z"), dashboard.formatDateTime("2026-09-06T12:34:00Z"));
});

test("Telegram event normalization uses the configured order and removes duplicates", () => {
  assert.deepEqual(Array.from(telegram.normalizeNotificationTypes(null)), []);
  assert.deepEqual(Array.from(telegram.normalizeNotificationTypes(["recommendation_approved", "unknown", "recommendation_created", "recommendation_approved"])),
    ["recommendation_created", "recommendation_approved"]);
  assert.equal(telegram.getTypeSummary([]), "No event types selected");
  assert.equal(telegram.getTypeSummary(["recommendation_approved", "recommendation_created"]), "New recommendations, Approved recommendations");
});

test("Telegram status copy distinguishes connection, pause, pending, and unavailable setup", () => {
  const disabled = { status: "DISABLED", enabled: false };
  const pending = { status: "PENDING", enabled: true };
  const connected = { status: "CONNECTED", enabled: true };
  const paused = { status: "CONNECTED", enabled: false };
  for (const [state, tone, label] of [[disabled, "is-disabled", "Disabled"], [pending, "is-pending", "Pending"], [connected, "is-connected", "Connected"], [paused, "is-disabled", "Connected"]]) {
    assert.equal(telegram.getStatusTone(state), tone);
    assert.equal(telegram.getStatusLabel(state.status), label);
  }
  assert.equal(telegram.getStatusCopy(disabled), "Choose the events you want and connect Telegram.");
  assert.equal(telegram.getStatusCopy(pending), "Open Telegram and start the bot to finish connecting.");
  assert.equal(telegram.getStatusCopy(connected), "Notifications are active.");
  assert.equal(telegram.getStatusCopy(paused), "Telegram is connected, but notifications are paused.");
  assert.equal(telegram.getStatusCopy({ ...pending, setup_available: false }), "Telegram setup is temporarily unavailable.");
  assert.equal(telegram.getStatusCopy({ ...connected, setup_available: false }), "Notifications are active.");
  assert.equal(telegram.getStateLabel(disabled), "Disabled");
  assert.equal(telegram.getStateLabel(paused), "Paused");
  assert.equal(telegram.getStateHeading(paused), "Notifications paused");
  assert.equal(telegram.isSetupAvailable(null), true);
  assert.equal(telegram.isSetupAvailable({ setup_available: false }), false);
});

test("Telegram delivery labels prefer username, retain leading @, and keep zero-chat fallback", () => {
  assert.equal(telegram.getDeliveryLabel({ telegram_username: "name", telegram_chat_id: 42 }), "@name");
  assert.equal(telegram.getDeliveryLabel({ telegram_username: "@name" }), "@name");
  assert.equal(telegram.getDeliveryLabel({ telegram_chat_id: 42 }), "Chat 42");
  assert.equal(telegram.getDeliveryLabel({ telegram_chat_id: 0 }), "No Telegram chat connected");
});

test("Telegram expiry and polling labels preserve rounding and elapsed-time boundaries", () => {
  const now = Date.parse("2026-09-06T12:00:00Z");
  assert.equal(telegram.getExpiryTime("invalid"), null);
  assert.equal(telegram.getExpiryTime(null), null);
  assert.equal(telegram.getExpiryTime("2026-09-06T12:00:00Z"), now);
  assert.equal(telegram.getTimeRemainingLabel(undefined, now), "No expiry time available");
  for (const [milliseconds, label] of [[-1, "Link expired"], [0, "Link expired"], [1, "1s left"], [59999, "1m 00s left"], [61000, "1m 01s left"]]) {
    assert.equal(telegram.getTimeRemainingLabel(new Date(now + milliseconds).toISOString(), now), label);
  }
  assert.equal(telegram.getPendingInstruction(undefined, now), "Start the bot from the active setup link.");
  assert.equal(telegram.getLastCheckedLabel(null, now), "Checking now");
  assert.equal(telegram.getLastCheckedLabel(0, now), "Checking now");
  assert.equal(telegram.getLastCheckedLabel(now - 1999, now), "Checked just now");
  assert.equal(telegram.getLastCheckedLabel(now - 2000, now), "Last checked 2s ago");
  assert.equal(telegram.getLastCheckedLabel(now + 1000, now), "Checked just now");
});

test("copy fallback preserves text, read-only selection, cleanup, and legacy false success", async () => {
  const calls = [];
  const textarea = {
    style: {}, value: "",
    setAttribute: (...args) => calls.push(["attribute", ...args]),
    select: () => calls.push(["select"]),
    remove: () => calls.push(["remove"]),
  };
  const { copyText } = sharedHelpers("clipboard.ts", {
    navigator: { clipboard: { writeText: async (value) => {
      calls.push(["clipboard", value]);
      throw new Error("Denied");
    } } },
    document: {
      createElement: (tag) => { assert.equal(tag, "textarea"); return textarea; },
      body: { appendChild: (node) => { assert.equal(node, textarea); calls.push(["append"]); } },
      execCommand: (command) => { calls.push(["command", command]); return false; },
    },
  });
  await copyText("# Recommendation\n\nUnicode: Привет");
  assert.equal(textarea.value, "# Recommendation\n\nUnicode: Привет");
  assert.deepEqual(textarea.style, { opacity: "0", position: "fixed" });
  assert.deepEqual(calls, [
    ["clipboard", textarea.value], ["attribute", "readonly", ""], ["append"], ["select"], ["command", "copy"], ["remove"],
  ]);
});
