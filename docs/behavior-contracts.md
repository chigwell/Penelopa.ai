# Behavior contracts for refactoring

These contracts describe observed behavior, including differences between routes. They are preservation constraints, not a new product specification. Tests use synthetic accounts, requests and transcripts; no production account is required.

## Browser and desktop transport

- Browser token key: `penelopa-api-token`; theme key: `penelopa-theme`. The default theme is light. Theme is reflected on `document.documentElement.dataset.theme`.
- Token reads trim whitespace; writes retain the supplied string. Transport token storage errors are tolerated. Keep existing theme-storage exception behavior unchanged.
- Dashboard and notifications consume a nonempty `#token=...` initially and on `hashchange`, removing the fragment while retaining path/query. Recommendation detail ignores token fragments.
- Dashboard persists submitted/hash tokens only after all three initial data requests succeed. Detail persists only after its request succeeds. Notifications accepts and stores a submitted/hash token before loading its settings.
- Dashboard initial requests are summary, 30-day daily activity and recommendation page 1 with page size 10, started in parallel. Changing pages loads only the recommendation list. Detail IDs are URL-encoded. Preserve existing loading/error text and request-completion ordering.
- Dashboard 401/403 clears auth and shows the invalid-token message. Other initial failures return to the token gate. Detail 404 and other non-auth failures show the unavailable view; 401/403 returns to the gate. Telegram auth expiry invokes the owning route's callback.
- Browser requests use `https://api.penelopa.ai/v1`, bearer authorization, JSON Accept and Content-Type when a body exists. A 204 or unparseable body becomes null; non-2xx raises the existing error with numeric status and detail/fallback text.
- Desktop bridge v1 uses a non-secret installed-session handle. The web renderer never receives or stores the installed bearer token. Main-process route/method/query/body restrictions and IPC sender checks remain in place. Reconnect uses Open Connection; sign-out is distinct from pausing capture.

## Rendering and interaction

- Home's missing metric is `...`; dashboard's missing metric is `—`. Compact notation starts at 100,000. Dashboard missing delta is `— / 24h`. Invalid report dates are `—`; Telegram missing/invalid expiry is `No active expiry`.
- Home, dashboard and detail copy controls first use the clipboard API, then the existing temporary-textarea/execCommand fallback. Preserve success feedback duration (1,600ms) and behavior when the fallback reports false. Demo clipboard failure is swallowed and still shows its copied feedback.
- Keep route-specific labels, button states, navigation targets, report markdown, chart series choices and responsive layout. Preserve all CSS rule ordering, selectors, media queries and keyframes, including generated Recharts class selectors.
- Demo is configured for Codex and Claude with 25 steps each, viewport-triggered autoplay once, explicit replay and agent switching. Abort behavior clears prior playback; reduced motion changes playback timing without removing scenes. All three screens remain mounted and use active classes.

## Telegram

- States remain DISABLED, PENDING and CONNECTED with a separate enabled/paused preference. Types are normalized to the configured option order; languages remain en/ru.
- Initial settings load, manual refresh, poll and draft updates retain their existing distinct loading flags and messages. Applying server settings resets drafts and disconnect confirmation.
- Pending, available and unexpired setup starts an immediate poll and a two-second interval, plus a one-second expiry clock. Focus/visible-document events refresh pending status. Expiry or unavailable setup stops polling; unmount cleans timers/listeners.
- Link creation validates selected types, PATCHes enabled preferences before POSTing the link, then applies the pending state. Empty PATCH responses trigger a settings refresh. Keep server error text for setup 503.
- Disconnect requires two clicks and DELETEs the connection only on confirmation. Pausing keeps the connection; system desktop notifications and Telegram preferences remain separate.

## Public routes and installers

- Public stats and GitHub proxy response payloads, upstream headers, error messages, 502 responses and cache headers stay unchanged. Successful stats cache is 30 seconds; GitHub retains its existing 300-second browser / 3,600-second shared cache and stale-while-revalidate policy.
- Installer flags, environment overrides, aliases, credential formats, default locations, exit behavior and standard-output contracts remain unchanged. Old hook commands remain recognized for ownership, repair, uninstall and upgrades. Preserve unrelated agent configuration.
- Validation precedes installation changes. Failed commits/activation restore credentials, launchers, agent definitions, runtime pointer and previous application. Updates reread agent settings after building. Sign-out does not stop hooks; pause retains queues; uninstall retains data unless purge is explicitly requested.

## Delivery and native boundaries

- Capture publishes a bounded durable event and returns without waiting for HTTP. Codex SessionEnd retains its three-second hook budget. Synthetic self-tests do not mark real agent activity.
- Queue receipts mean spooled, not acknowledged by the server. Missing/replaced/truncated transcripts remain actionable errors. Complete JSONL records and captured byte boundaries determine saved bytes.
- Preserve v2 outbox/state layout, epochs, hashes, idempotency keys, strict accepted-offset/hash ACK checks, retry scheduling, quarantine, cursor monotonicity and interruption recovery. POSIX and PowerShell have intentional encoding/filesystem/tool differences.
- Closing the window hides it to tray; Quit closes the desktop while hooks continue independently. Preserve native notification baseline/deduplication/account behavior, startup preferences and daily update checks.
- Remote and local IPC remain separate. Reject foreign frames, subframes, destroyed frames, arbitrary origins, unapproved API methods and generic command execution from the remote renderer.
- Native release evidence requires Linux hooks, macOS arm64/Intel and Windows x64 checks plus the documented clean-machine gates. Local unit/browser tests do not substitute for that matrix.

## Build and release exception

The user explicitly approved changing build/test side effects. Website build must not regenerate tracked release assets. Desktop tests and native verification must exercise fresh scratch bundles; a separate read-only command checks committed published assets. Only `release:desktop` prepares publishable assets, and changed content requires a new versioned URL. No refactor pass deploys or silently replaces a published version.
