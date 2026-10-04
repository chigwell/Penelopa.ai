# Admin UI specification

The maintained admin-facing UI is the personal dashboard: Overview, Sessions library/detail, Notifications and recommendation detail. This pass preserves features, navigation, displayed information, public APIs and request timing. Public pages, native settings, backend migrations and release publication are separate work.

## Presentation contract

Retain the paper/ink light and dark themes, DM Serif Display headings, DM Sans body and DM Mono metadata. Use page headings of 32–48px, body text of 14–16px, secondary metadata of at least 12px, section gaps generally 24–32px and primary mobile control targets of at least 44px. Existing content widths, section order and the 960px inspector breakpoint remain.

Compact oversized headers, panel gaps and empty states. Keep every existing action and field visible. Wrap filters/toolbars and long labels rather than clipping them. Page-level horizontal overflow is unacceptable; bounded transcript/code panes and the recommendation table may scroll internally. Errors belong with their fields and existing save feedback is announced politely. No autosave, new defaults, menu redesign or changed draft-reset rules are included.

## State and parity matrix

Review every row in light/dark, browser/desktop access, and narrow/wide layouts; automated fixtures cover representative states and manual checks complete the matrix. Desktop installed credentials stay in the main process; older desktop clients show the existing Sessions update prompt.

| Route | Initial/access | Loaded/refresh | Empty/unavailable | Failure/expired |
| --- | --- | --- | --- | --- |
| Overview | Skeleton until all three initial reads settle; route-owned token gate | Five metrics, recent sessions, both notification summaries, activity and recommendations; refresh preserves content | Existing no-session/no-recommendation states | Retry initial/transient failures; 401/403 clears access; late requests cannot restore signed-out content |
| Sessions library | Account/catalog verification and destination skeleton | URL project/source/period/cursor filters, pages of 25; refresh preserves the page | Distinct fresh library and filtered-empty states | Retry transient failure; scoped 403 remains an access restriction; 401 signs out |
| Sessions detail | Metadata and bounded event loading | Events/Process, URL event/block/step selection; history and latest snapshots; Follow initially off | Explicit retention/missing content/process-not-ready states | Retry without replacing selected content; selection/account races ignored |
| Notifications | Route accepts the token before independent channel reads; full skeletons | Separate Telegram and Webhook drafts/actions; reads cancelled before mutation | Disabled, pending, connected/paused Telegram; configured/enabled/paused Webhook | Existing channel errors, retry, server text and auth expiry |
| Recommendation detail | Ignores hash tokens; persists submitted token only after success | Existing Markdown, metadata and 1,600ms copy feedback | 404/unavailable and invalid-link views | Retry transient failures; 401/403 returns to access gate |

## Request traces protected by fixtures

| Interaction | Preserved request contract |
| --- | --- |
| Overview sign-in | Parallel `/v1/admin/stats/summary`, `/v1/admin/stats/daily-activity?days=30`, `/v1/hermes/recommendations?page=1&page_size=10`; independent recent sessions, Telegram and Webhook reads after readiness |
| Recommendation pagination | Only the recommendation list request, page size 10 |
| Library/detail | Existing v2 GET paths and ordered parameters; library limit 25, event limit 100, search limit 50, content fragment 16,384 characters |
| Telegram link | Preferences PATCH precedes link POST; pending available/unexpired setup polls immediately and every two seconds |
| Webhook save/disconnect | PATCH/DELETE `/v1/user/recommendation-webhook`; empty responses reload settings; the bearer token and signing secret never enter diagnostics |

Browser fixture assertions in `web-contracts.spec.mjs`, `loading-experience.spec.mjs` and `sessions.spec.mjs` retain request/interaction parity. Reviewed baseline images live in `visual-parity.spec.mjs-snapshots/` and `sessions-visual.spec.mjs-snapshots/`. Structural passes must compare against those images unchanged. Only approved dashboard presentation passes may update their snapshots; public/demo/legal snapshots remain regression checks.

## Acceptance checklist and evidence

- Keyboard: reach all navigation, filters and actions; timeline arrows select adjacent events; mobile native dialog confines Tab/Shift+Tab, Escape dismisses and focus returns.
- Resize with a selected event at 959/960px: modal/aside switches without losing the URL selection, content or body scrolling.
- Reflow: narrow/wide screens, 200% zoom equivalent, long titles/URLs and long report/transcript content; no page overflow or inaccessible controls.
- Loading/error/empty/refresh states retain context in both themes; reduced motion suppresses loading/entrance/scroll effects.
- Telegram preference order, polling/expiry, disconnect confirmation and Webhook secret preserve/replace/clear, 204 reload and delayed-read/mutation/logout races remain protected.
- Typecheck, web unit/contracts/visual suites, website build and production-runtime browser contracts pass. Desktop transport is unchanged; published assets remain untouched.

Validation uses synthetic accounts and transcripts. It does not establish live backend ownership enforcement, retained production content, native packaging, screen-reader usability or clean-consumer-OS release readiness. Visual comparisons use macOS Chromium. Human review of the compact layout, real browser zoom and assistive technology remains a follow-up before release.

Fresh baseline and per-pass evidence are recorded in `refactor-ledger.md`. Use pinned Node 24.20.0 for reproducible runtime evidence. CI currently runs Linux/Windows; production browser contracts are now included in Linux CI. macOS visual automation remains an infrastructure follow-up.

## Implementation evidence · October 2026

The eleven passes and their independent extraction commits are recorded in the ledger. Structural comparisons retained all 44 admin screenshots; the subsequent approved compact presentation changes were reviewed and committed as updated admin baselines. The 16 public/legal/MCP images remain unchanged.

Pinned Node 24.20.0 validation passes: typecheck, 47 unit checks, 61 development browser checks, 60 visual comparisons, website build, 58 production-worker browser checks and read-only published desktop-asset integrity. The build changed none of 287 tracked files. UX cases cover 390/640px in both themes, all five routes, long project/report/notification content, internal table scrolling, live-state readability, 44px narrow controls and error/body/confirmation-hover contrast. Native dialog keyboard traversal and the 959/960px transition have dedicated browser checks.

Human verification of real 200% zoom, screen-reader speech, production fonts and installed desktop presentation remains before release. Dependency/framework/backend/bridge migrations, signing and deployment remain separate tasks.
