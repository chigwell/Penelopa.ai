"use strict";
const fs = require("node:fs");
const path = require("node:path");

// Called only after the main process validates a local IPC sender.
function createLocalAction({
  root,
  getAuth,
  getWindow,
  dialog,
  localState,
  pushState,
  clearNativeError,
  quit,
  commands: {
    showPage,
    wakeWorker,
    managedCommand,
    notify,
    checkUpdate,
    startUpdater,
  },
  runtime: { settings, installState, writeJson, diagnostics, setAutostart },
}) {
  return async function localAction(action, data) {
    switch (action) {
      case "state":
        return localState();
      case "navigate":
        if (
          !["dashboard", "notifications", "connection", "settings"].includes(
            data,
          )
        )
          throw new Error("Unknown page.");
        showPage(data);
        break;
      case "retry":
        wakeWorker();
        break;
      case "repair":
        await managedCommand(["--repair"]);
        clearNativeError();
        break;
      case "connect":
        await getAuth().connect();
        if (getAuth().token) showPage("dashboard");
        break;
      case "sign-out":
        getAuth().signOut();
        showPage("connection");
        break;
      case "preferences": {
        if (
          !data ||
          Array.isArray(data) ||
          Object.entries(data).some(
            ([key, value]) =>
              !["paused", "notifications", "autostart"].includes(key) ||
              typeof value !== "boolean",
          )
        )
          throw new Error("Invalid app settings.");
        const old = settings(root);
        const next = { ...old, ...data };
        if (next.autostart !== old.autostart)
          setAutostart(next.autostart, installState(root));
        if (next.notifications !== old.notifications)
          fs.rmSync(path.join(root, "notification-state.json"), {
            force: true,
          });
        writeJson(path.join(root, "preferences.json"), next);
        if (!next.paused) wakeWorker();
        break;
      }
      case "test-notification":
        notify([
          { id: "", title: "Notifications are enabled for this computer." },
        ]);
        break;
      case "export-diagnostics": {
        const result = await dialog.showSaveDialog(getWindow(), {
          title: "Export connection diagnostics",
          defaultPath: "penelopa-diagnostics.json",
          filters: [{ name: "JSON", extensions: ["json"] }],
        });
        if (!result.canceled && result.filePath)
          writeJson(result.filePath, diagnostics(root));
        break;
      }
      case "check-update":
        await checkUpdate();
        break;
      case "update":
        startUpdater("--prepare");
        break;
      case "uninstall": {
        const result = await dialog.showMessageBox(getWindow(), {
          type: "question",
          buttons: ["Cancel", "Uninstall"],
          defaultId: 0,
          cancelId: 0,
          message: "Uninstall Penelopa.ai?",
          detail:
            "Only Penelopa hooks, the app and its startup entry will be removed. Other agent settings stay in place.",
          checkboxLabel: "Also delete my local credentials and queued data",
          checkboxChecked: false,
        });
        if (result.response === 1)
          startUpdater("--uninstall", result.checkboxChecked);
        break;
      }
      case "quit":
        quit();
        break;
      default:
        throw new Error("Unknown desktop action.");
    }
    pushState();
    return localState();
  };
}

module.exports = { createLocalAction };
