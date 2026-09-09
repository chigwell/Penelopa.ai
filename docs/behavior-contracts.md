# Product behavior and compatibility contracts

These contracts describe the maintained behavior after the approved Session Explorer and loading redesign. The earlier refactor freeze on layouts, CSS fingerprints, loading text and request completion order is superseded for this feature. Authentication, ownership, IPC, capture and installer boundaries below still apply. Tests use synthetic accounts, requests and transcripts; no production account is required. See [Session Explorer](session-explorer.md) for integration and release notes.

## Browser and desktop transport

- Browser token key: `penelopa-api-token`; theme key: `penelopa-theme`. The default theme is light. Theme is reflected on `document.documentElement.dataset.theme`.
- Token reads trim whitespace; writes retain the supplied string. Transport token storage errors are tolerated. Keep existing theme-storage exception behavior unchanged.
- Dashboard, notifications and Sessions routes consume a nonempty `#token=...` initially and on `hashchange`, removing the fragment while retaining path/query. Recommendation detail ignores token fragments. Sessions also observes browser token-storage changes.
- Dashboard persists submitted/hash tokens only after all three initial data requests succeed. Recommendation detail persists only after its request succeeds. Sessions persists a submitted/hash token after the owning session or catalog request succeeds. Notifications accepts and stores a submitted/hash token before loading its settings.
- Dashboard initial requests are summary, 30-day daily activity and recommendation page 1 with page size 10, started in parallel. Once ready, the page reads the five latest sessions and Telegram settings independently. Changing recommendation pages loads only that list. IDs and query parameters are URL-encoded.
- Dashboard 401/403 clears auth and shows the invalid-token message. A temporary initial failure shows a retryable data-error screen; a temporary refresh failure preserves the loaded dashboard and token. Recommendation 404 and other non-auth failures show the unavailable view; transient errors can be retried and 401/403 returns to the gate. Telegram auth expiry invokes the owning route’s callback. Sessions 401 clears authentication; 403 reports the access restriction without treating a scoped denial as an invalid credential.
- Existing browser requests use `https://api.penelopa.ai/v1`; transcript reads use explicit v2 GET transport under `https://api.penelopa.ai/v2/user-read/*` and `/v2/process/*`. Both use bearer authorization, JSON Accept and Content-Type when a body exists. A 204 or unparseable body becomes null. Errors retain numeric status; v2 also preserves structured backend codes/details.
- Desktop bridge v1 uses a non-secret installed-session handle. The web renderer never receives or stores the installed bearer token. Transcript support is negotiated through `capabilities.transcriptRead`; an older app offers an update without attempting v2 IPC or falling back to browser credentials. Main-process route/method/query/body restrictions and IPC sender checks remain in place. Reconnect uses Open Connection; sign-out is distinct from pausing capture.
- Abort obsolete browser reads and ignore late desktop IPC responses. Logout, account changes, route changes and selection changes must not allow an earlier response to restore private content or replace the current selection.

## Rendering and interaction

- Home shows skeletons during statistics/GitHub loading; its unavailable metric formatter remains `...`, while dashboard’s missing metric is `—`. Compact notation starts at 100,000. Dashboard missing delta is `— / 24h`. Invalid report dates are `—`; Telegram missing/invalid expiry is `No active expiry`.
- Home, dashboard and detail copy controls first use the clipboard API, then the existing temporary-textarea/execCommand fallback. Preserve success feedback duration (1,600ms) and behavior when the fallback reports false. Demo clipboard failure is swallowed and still shows its copied feedback.
- The shared topbar exposes Overview, Sessions and Notifications. The existing warm light/dark themes, font families, report Markdown and chart series remain. Approved layout and loading changes may update selectors and visual baselines after review; no whole-stylesheet fingerprint is required.
- Initial data loading uses skeletons sized for the destination view, without displaying the access form. Refreshes retain loaded content. Skeletons expose loading state to assistive technology; decorative shapes are hidden. Reduced motion disables shimmer, progress/spinner loops and entrance effects, as well as Sessions scrolling/animations. Visible keyboard focus remains required.
- Stylesheet checks protect resolved imports, base/responsive/feature cascade boundaries, shared theme tokens and contrast, focus outlines and reduced-motion overrides. Screenshot expectations may change only for reviewed product changes; an updated hash or screenshot alone is not verification.
- Demo is configured for Codex and Claude with 25 steps each, viewport-triggered autoplay once, explicit replay and agent switching. Abort behavior clears prior playback; reduced motion changes playback timing without removing scenes. All three screens remain mounted and use active classes.

## Session Explorer

- `/dashboard/sessions` lists user-read sessions in pages of 25, newest activity first, with project, source and time filters. The dashboard shows five recent sessions. No total-page count is invented for cursor APIs.
- `/dashboard/sessions/[id]` starts in Events. Process is a derived overview and its absence must not prevent reading retained events. Filters, cursors and the selected event/block/step live in the URL; browser history remains usable.
- Render bounded event pages (at most 100 rows), one inspector and one content fragment at a time. Content requests default to 16,384 characters; copy feedback distinguishes a complete section from a fragment. An event can contain several message/tool blocks, all independently addressable.
- The detail pane is beside the timeline at 960 px and above; narrower views use a full-screen modal with trapped focus, Escape dismissal and focus restoration. Arrow keys on timeline rows move between events. Links to event sections open the corresponding block, including blocks beyond the first section page.
- Event previews and text search are bounded/indexed projections. Exact retained detail comes from the versioned redacted payload, including Source data; it must never be reconstructed as purported original content from a shortened preview. Missing, expired, archived or removed content gets an explicit availability state.
- Sequence and watermark values use decimal strings in JavaScript and BigInt for ordering. Process analysis IDs, source epochs and event activation revisions have distinct roles; do not replace them with wall-clock timestamps or floating-point numbers.
- Visible, online HOT sessions poll for changes every three seconds, with one tail operation in flight and backoff capped at 30 seconds. Hidden/offline views pause. Follow is off initially; reading history or opening an older event must not move the user to new events. Jump to latest/new-event actions obtain a current bounded window. Reparse resets invalidate stale event windows; analysis changes refresh Process independently.
- Backend queries remain owner/scoped-token constrained. Related tool references are scoped by owner, session, epoch and call ID. The UI explicitly reports incomplete historical indexing. Transcript text, credentials and content cursors must not enter application diagnostics or analytics logs.

## Telegram

- States remain DISABLED, PENDING and CONNECTED with a separate enabled/paused preference. Types are normalized to the configured option order; languages remain en/ru.
- Initial settings load uses compact/full skeletons. Manual refresh and polling retain loaded settings and use distinct flags; overlapping reads are deduplicated. Reads are cancelled before a mutation so an older response cannot overwrite its result. Applying server settings resets drafts and disconnect confirmation.
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
