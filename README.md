# Penelopa.ai

Continuous improvement for AI coding agents. Connect Codex and Claude Code once, keep working, and review practical recommendations in your personal dashboard or desktop companion.

## Install

### macOS and Linux

```sh
curl -fsSL https://penelopa.ai/script | sh
```

If your Linux installation has wget instead of curl:

```sh
wget -qO- https://penelopa.ai/script | sh
```

### Windows PowerShell

```powershell
$installer = Join-Path $env:TEMP "penelopa-install.ps1"
Invoke-WebRequest -UseBasicParsing -Uri "https://penelopa.ai/script.ps1" -OutFile $installer
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer
```

The command downloads a verified private Node/npm runtime, connects your account, configures the hooks, and builds **Penelopa.ai** on your computer. Git, Python, system npm, Homebrew, Xcode and Visual Studio are not prerequisites. No system package manager or global PATH is changed.

Desktop targets: **macOS 13.5+ on Apple Silicon or Intel**, and **Windows 10 22H2+ / Windows 11 x64**. Linux x64/arm64 with kernel 4.18+ and glibc 2.28+ supports hooks only. Windows ARM and Linux Desktop are not included in this release. Allow **3 GB of free space** for desktop builds, staging and rollback, plus internet access to Penelopa, nodejs.org, the npm registry, and official Electron release downloads.

## Finish connecting

1. In Codex, open **Settings → Hooks**, review **Stop** and **SessionEnd**, and trust them. In the CLI, use `/hooks`. Installing the files does not automatically approve them.
2. The desktop app opens with your installed account. No token needs to be copied into the client.
3. Open **Connection** to see configured agents, the first real hook event, queued data and the last server-confirmed upload. The installation self-test uses synthetic data locally; it does not prove that an agent has approved its hooks.
4. Continue a coding session. The status changes to **Connected** after a real event is observed.
5. Enable system notifications or launch at login in **App settings** if wanted. Telegram preferences remain separate and are not changed by installation.

Closing the window keeps Penelopa in the tray/menu bar. **Quit** closes the desktop client; hooks still capture events and launch their own delivery worker. Failed uploads remain queued, and are retried by the running client or subsequent hook events. No additional always-running system service is installed.

The app displays the current web dashboard, including activity, recommendations, individual reports and Telegram settings. An internet connection is needed for these pages. Connection diagnostics and app settings remain available offline.

## Local signing

Mac builds receive an **ad-hoc signature**, without a Developer ID or notarization. Windows builds do not claim a trusted publisher signature. These are local builds; Gatekeeper, SmartScreen, enterprise policies and notification permissions can still require user action or prevent launch. The installer reports a desktop failure separately and preserves successfully installed hooks. It does not disable OS protections, strip quarantine attributes or add trusted root certificates.

## Recovery and maintenance

After installation, commands can run offline from the private runtime. On macOS/Linux:

```sh
"$(cat "$HOME/.auto-improve/node-path")" "$HOME/.auto-improve/bin/penelopa.cjs" --diagnose
"$(cat "$HOME/.auto-improve/node-path")" "$HOME/.auto-improve/bin/penelopa.cjs" --repair
```

Alternatively, download/rerun the original installer with these options. PowerShell uses the corresponding names, for example `-Diagnose`, `-Repair`, `-NoDesktop`.

| Option | Purpose |
| --- | --- |
| `--agent codex\|claude\|both` | Choose agents; default is both |
| `--no-desktop` | Install hooks without building a client |
| `--desktop required` | Require a supported production desktop target |
| `--diagnose` | Print diagnostics without credentials or transcripts |
| `--repair` | Restore Penelopa hooks and repeat the local self-test |
| `--no-launch` | Build without opening the app |
| `--force-new-token` | Explicitly create a new account token |
| `--print-access-link` | Explicitly reveal a private browser sign-in link |
| `--uninstall` | Remove Penelopa hooks/app/startup registration, retaining account and queued data |
| `--uninstall --purge-data` | Also remove Penelopa credentials and local queued data |

Normal installation logs do not print tokens or private sign-in URLs. A repeated installation reuses the account. **Sign out of client** does not pause collection; **Pause collection** stops new capture and delivery while preserving the queue. Authentication errors do not automatically create a new account.

Existing endpoint, token, environment-file, source-schema and upload-limit options remain available; use `--help`. The old `--install-deps` switch is retained for compatibility; private runtime installation is automatic. Explicit custom uploader URLs must implement the current snapshot/receipt contract. Custom API endpoints are supported for hooks only and disable desktop account import.

## Local data

- Runtime, versioned source, worker, pending events and app settings: `~/.auto-improve` (override with `AUTO_IMPROVE_HOME`).
- Existing credential formats are retained: `~/.auto-improve-hook.env` or `~/.auto-improve-hook.json`, protected for the current user. Independent hooks need this credential file; it is not encrypted by the desktop app.
- The desktop's credential copy uses Electron safeStorage/Keychain/DPAPI. Tokens are not exposed to the web renderer. A local Mac signature change may cause Keychain to request access again after an update.
- Mac application: `~/Applications/Penelopa.ai.app`; Windows: `%LOCALAPPDATA%/Programs/Penelopa.ai` with a Start Menu shortcut.
- `AUTO_IMPROVE_DATA_DIR`, `AUTO_IMPROVE_HOOK_CONFIG`, `CODEX_HOME` and `CLAUDE_CONFIG_DIR` remain supported. App settings and credentials are stored outside the replaceable app bundle.

## Development and release

```sh
npm ci
npm run typecheck
npm run test:desktop
npm run build
```

`npm run release:desktop` creates deterministic source ZIPs, checksummed manifests and the public shell/PowerShell bootstraps. Source bundles contain an isolated desktop lockfile and the existing durable uploaders. Installation uses `npm ci --ignore-scripts` and an explicitly verified Electron archive; it does not run arbitrary npm lifecycle scripts or compile Chromium.

See [desktop delivery notes](docs/desktop-delivery.md) for the architecture, CI matrix, launch verification and release sequence. Versions and official runtime hashes are pinned in `desktop/release-config.json`; desktop package versions must match. Release assets are generated during the website build.

The desktop checks for updates at startup and daily. **Update & restart** prepares the next version outside the running app, checks its signature/launch, and then replaces it. Failure keeps the previous working bundle and the existing account, settings and queue.

For data processing details, see [Privacy](PRIVACY.md) and [Terms](TERMS.md).
