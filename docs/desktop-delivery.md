# Desktop delivery

## Components

The root project serves the existing dashboard and static installer assets. `desktop/` is an isolated Electron project with its own lockfile; it is not a second implementation of the dashboard.

- `app/lib/penelopa-client.ts` owns web-versus-desktop auth and HTTP transport. The browser keeps its existing localStorage/token-link flow. The desktop uses a non-secret session handle and a narrow request bridge.
- `desktop/main.cjs` owns credentials, restricted API calls, tray lifecycle, native notifications and local screens. The remote WebContentsView has no Node integration, runs sandboxed, and cannot execute commands or read files through IPC. Native repair/update/uninstall actions are restricted to the local renderer. Sender checks require the correct main frame and origin.
- `runtime/install.cjs` validates both agent configurations before changing them. It preserves unrelated hooks, takes backups, installs stable launchers, and records ownership for removal. Reinstalling with a narrower agent choice does not forget previously managed hooks.
- Capture writes a bounded event descriptor durably and returns. A detached Node worker tails complete JSONL data through the existing POSIX/PowerShell uploader, then separately drains the durable outbox. Queue receipts are distinct from network acknowledgements. A missing/replaced source remains an error; queued bytes are not marked delivered without the v2 acknowledgement.
- On Windows, agent commands invoke the installed private Node executable and `bin/hook.cjs` directly. PowerShell remains in the bootstrap and background uploader, but does not relay capture stdin/stdout. This avoids its native pipeline leaking capture pipe handles into the detached worker and making a completed hook appear to time out.
- System notifications poll the existing paginated recommendation endpoint. Initial results establish a baseline; account-scoped IDs are persisted before toasts are displayed. There are no system alerts for operational errors.

## Release assets

Run `npm run release:desktop` explicitly to prepare a new desktop release after changes to desktop code, bootstrap templates, uploaders or pinned versions. Website builds and tests do not prepare releases. This generates:

- `public/desktop/bootstrap.cjs`: bundled bootstrap with only Node built-ins.
- `public/desktop/releases/<version>/source.zip`: deterministic ZIP/STORE source bundle; no installed dependencies or user data.
- Versioned and current `manifest.json`: source digest, Node/Electron versions and official archive digests.
- `public/script` and `public/script.ps1`: bootstrap runtime hashes and bootstrap digest embedded at generation time.

The POSIX bootstrap needs standard OS shell tools and curl or wget. Windows uses Windows PowerShell/.NET and Expand-Archive. Once Node is available, source ZIP extraction and upload HTTP requests use Node built-ins. npm runs privately and with lifecycle scripts disabled. Artifact SHA-256 validation provides integrity checking over HTTPS; it is not an Apple/Microsoft publisher signature or independent protection against compromise of the release server.

Versioned release URLs are immutable after publication. Bump `desktop/package.json`, `desktop/package-lock.json` and `desktop/release-config.json` together for every published source change. Generation checks both versioned files before writing any entrypoints and refuses different content at an existing version; identical regeneration is allowed. Keep previously published version directories available when deploying a later release; retain them in the static asset deployment or an archive origin. Do not regenerate an already published version from different source and overwrite its URL.

Deployment sequence:

1. Ship/test the additive web auth bridge before distributing a client that depends on it.
2. Pass the installer tests and native package/launch matrix.
3. Publish immutable source archives and versioned manifests; verify their hashes from the deployed origin.
4. Publish the current manifest and generated installer entrypoints together. A mismatched cached bootstrap fails closed and asks the user to refresh the command.
5. Verify `/desktop/manifest.json`, `/desktop/bootstrap.cjs`, `/script`, `/script.ps1`, and all referenced source archives from the public site. Check the existing API's read-only routes; do not create production test accounts automatically.

There is no automatic production deployment in the verification workflow. Installing the app locally is not evidence of a successful Windows or Intel Mac release.

## Verification

Run delivery tests with the Node version pinned in `desktop/release-config.json` and CI (currently 24.20.0). The Node 22.22.1 `Response.formData()` parser rejects the .NET multipart fixture's unquoted disposition parameters; the same synthetic body and all managed PowerShell acknowledgement tests pass on the pinned runtime. This parser difference requires no uploader behavior change.

- `npm run build` builds only the website from the checked-in static assets.
- `npm run test:desktop` generates current desktop source and bootstrap assets in a temporary directory, runs isolated fixtures against that source, and removes the generated assets afterward. Direct `node --test desktop/test/*.test.cjs` invocations also generate temporary current-source bundles when needed.
- `npm run verify:desktop-assets` checks every checked-in versioned source archive, current/versioned manifest parity, and the current bootstrap/installer hashes without writing files. It verifies published integrity, not parity with unpublished working source.
- `npm run verify:desktop-build` generates current-source assets in its retained temporary build directory and runs native packaging/launch verification against them.
- `npm run release:desktop` is the explicit publication-preparation command; it does not deploy anything.

The generator accepts an explicit source root and output directory, uses deterministic ZIP/STORE entries, and preserves the public asset layout. Tests compare independent generations, current-source contents, immutable-release rejection, and source-tree non-mutation. CI separately checks published integrity and rejects tracked changes after validation.

Tracked text uses LF checkout endings through `.gitattributes`, including on Windows. This keeps checksummed bootstrap files and deterministic source bundles independent of `core.autocrlf`; binary archives and images remain untouched.

Shared POSIX/PowerShell characterization scenarios verify partial JSONL and EOF finalization, retained bytes across replacement/truncation epochs, captured boundaries and quarantine without acknowledgement advancement. Existing managed-delivery tests retain offline, invalid-ACK, idempotency and worker-interruption coverage. Windows SID/ACL characterization runs with an injected Windows host on every platform; real ACL and native launch checks still require the OS matrix.

`npm run test:desktop` runs isolated fixtures. The tests never use personal agent directories or production credentials. Network tests use loopback HTTP and synthetic transcripts; environments that forbid local listening need permission to run those tests outside the sandbox.

The native build verifier (`node scripts/verify-desktop-build.cjs`) downloads the pinned private Node into a temporary directory, extracts a verified temporary archive generated from current source, packages for the host CPU, ad-hoc signs on macOS, and starts the resulting executable. Its launch check renders the local UI, verifies the isolated preload bridge, and saves a screenshot beside the marker under the temporary build directory. It does not install into Applications, register autostart, access Keychain or modify the user's hooks.

The GitHub workflow covers Linux hooks, macOS arm64/x64 and Windows x64. Hosted runners have developer tools installed; the isolated installer test and minimal PATH checks reduce accidental dependency on them, but do not replace testing clean consumer OS images.

Local refactor verification on 6 September 2026: all 38 desktop tests passed without skips on macOS arm64 with Node 24.20.0, including execution of the managed PowerShell tests. Current-source packaging with private Node 24.20.0 and Electron 44.2.0 passed ad-hoc signature verification, native startup, isolated preload checks and a rendered Connection-screen screenshot. Source SHA-256 was `8073b0af7ba41b12817487b2cf1f83c43ca9ebf1ff22e94cc2acdb7ff2e00a0a`. Evidence is retained locally under `/private/tmp/penelopa-build-ehdWIH/` (`verification.json`, `signature-verification.json`, `retained-smoke.json`, screenshot and `source-verification.json`). Published assets passed their separate integrity check; no release was generated into the public directory or deployed. See the refactor ledger for web validation.

The subsequent [CI verification](https://github.com/chigwell/Penelopa.ai/actions/runs/34051596257) passed Linux, macOS arm64/Intel and Windows, including native package/launch checks on both Macs and Windows. A test-only correction aligned the new PowerShell fixture's Unicode JSON encoding with the existing managed worker; two buffered-reader regression cases bring the desktop suite to 40 cases (Windows passes 38 and intentionally skips the two POSIX cases). Production delivery code is unchanged by that correction. Clean-machine checks below remain release gates.

Windows managed delivery flushes individual files before atomic publication and retains unacknowledged events across process termination. It does not use private PowerShell reflection types to flush directory handles or request privileged volume flushes. Power-loss durability still depends on the filesystem and storage device; clean-machine and interruption checks remain release gates.

Before public release, manually verify on clean standard-user macOS arm64/Intel and Windows 10/11 x64 accounts:

- Bootstrap with no Git, system npm, Python, Homebrew or compiler; GUI launch with a minimal PATH.
- Gatekeeper/SmartScreen behavior from a downloaded installer; no global policy changes or trusted-root installation.
- Actual Codex/Claude hook approval, first real event and a server-confirmed upload.
- Keychain/DPAPI reconnect, sign-out across restart, and 401/403 behavior.
- Native notification permission, burst grouping and click-through from a hidden window; Telegram remains unchanged.
- Start at login on/off, Quit, offline queues, sleep/wake, and worker recovery.
- Update from an older installed version, failure during download/build/activation, rollback, and uninstall with and without local-data removal.

## Compatibility boundaries

Client bridge version 1 allows only the existing stats, recommendations and Telegram routes. There is no generic command or arbitrary-origin HTTP interface. Browser auth remains available when the desktop bridge is absent.

Source/runtime versions and OS requirements are pinned, not resolved to `latest` on a user's computer. macOS uses ad-hoc signing with the JIT and library-validation entitlements Electron needs. Windows uses a local unsigned bundle and a stable AppUserModelID shortcut. Native security policies remain in force. Desktop/notification failures are reported locally without deleting a working hook setup.

The existing v2 outbox layout, epoch handling, idempotency keys and strict acknowledgement validation are retained. `AUTO_IMPROVE_SNAPSHOT_SIZE`, `AUTO_IMPROVE_RECEIPT_FILE`, `AUTO_IMPROVE_SPOOL_ONLY`, `AUTO_IMPROVE_TRANSPORT` and the internal `Drain` event add worker control without changing the public ingestion API. Earlier snapshot events cannot roll an acknowledged cursor backward. POSIX hook definitions use a stable launcher and the private runtime pointer. Windows commands name the private Node executable directly. Reinstallation, repair and desktop updates migrate previously owned commands while preserving other hooks; update failure restores the launchers, runtime pointer and definitions together. Changed commands, including the Windows migration from 1.0.2, may require renewed approval in the agent.
