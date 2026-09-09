# Session Explorer

Session Explorer makes captured Codex and Claude Code work readable as a session library, an event timeline and a derived Process overview. The website and supported desktop apps share the same views. This document describes the implementation and release procedure; no deployment or desktop publication has been performed by this work.

## Exploring a session

Open **Sessions** from the dashboard navigation or choose one of the five recent sessions below the usage totals. The library shows 25 sessions at a time, sorted by latest activity. Filter by project, agent or the last 7, 30 or 90 days. The title uses the first retained user-message preview, with project/date as a fallback. Cursor paging does not claim a total number of pages.

A session opens in **Events**. Search its indexed transcript text or filter events by type, actor, status and tool name. Text search uses the server's searchable projection; it is not a full-content scan of every retained JSON field. Select a row to read messages, inputs, outputs and metadata. Unknown event types remain visible. **Process** presents interpreted steps and their supporting evidence; it may become available after Events.

The inspector appears beside the timeline at widths of 960 px or more and as a full-screen modal on narrower screens. Arrow keys on event rows move the selection. On mobile, Escape closes the modal and restores focus. The URL retains the session, active view, filters, page and selected event/block/step. **Copy link** creates an authenticated navigation link; it does not make a private transcript publicly accessible.

A single captured event can contain many message or tool blocks. **More message blocks** opens later section pages. **Related tool events** connects tool input/output within the same session and source epoch. **Source data** exposes retained redacted JSON. Long sections are read in fragments; **Copy content** is used only when the complete section fits in the first response, otherwise the action says **Copy fragment**. Incomplete Markdown fragments are displayed as text so a split code fence does not corrupt the rest of the inspector.

**Jump to latest** reads a fresh last window. **Follow** is initially off; enable it to scroll with incoming events. Reading an earlier event or moving away from the latest view pauses following. New-event buttons let the reader choose when to advance. Updates reflect data already received by the server; the feature does not add a new real-time capture/upload mechanism.

## Loading, retention and access

Initial loads use theme-aware skeletons. Dashboard refresh keeps the existing page visible, including during temporary failures. Recommendation selection, logout and account changes cancel obsolete browser requests and discard late desktop IPC responses. The shared skeletons also cover recommendation detail/expansion, Telegram settings and homepage statistics/GitHub counts. Reduced-motion preferences disable loading loops and entrance effects.

Availability is explicit:

| State | What the reader sees |
| --- | --- |
| Process has not been produced | Events remains usable; Process explains that its overview is not ready. |
| Event metadata remains but payload expired | Metadata remains available where the API permits it; detail does not substitute a shortened preview for full content. |
| Session is archived, compacted or deleted | Storage-history messaging and any retained Process overview; no automatic raw-archive restore. |
| Historical tool references still need indexing | A notice in Related tool events; the backfill can be resumed. |
| 401 | Sign in/reconnect; private loaded state is cleared. |
| 403 | The requested scope is outside access; Sessions does not interpret this as an invalid account token. |
| 404 / 410 | An unavailable/retention state, distinct from loading and authentication. |
| Temporary network failure | A retry action or preserved event view with an update error. |
| Older desktop bridge | Existing overview functionality remains; Sessions explains how to update the app. |

Browser credentials retain their existing storage and hash-token behavior. Desktop credentials remain in the main process. The renderer receives the existing installed-session handle, not the bearer token. The additional capability is `window.penelopaDesktop.capabilities.transcriptRead === true`; without it, the web UI does not try v2 IPC or fall back to browser credentials. Read [behavior contracts](behavior-contracts.md) for route-specific token persistence rules.

## Data and integration

The client implementation is in `app/dashboard/sessions/`, with DTOs in `app/lib/transcript-types.ts`. Explicit v2 GET transport shares the established v1 browser/desktop transport. The companion backend source lives in the sibling **auto-improve** repository (`../auto-improve/backend`), not in this website repository.

Use the **user-read** catalog as the complete source of sessions. Process APIs describe analyzed sessions and steps; they do not replace the catalog. Public production URL prefixes are `https://api.penelopa.ai/v2/user-read` and `https://api.penelopa.ai/v2/process`. Inside the backend app, the corresponding routes are mounted under `/api/v2`.

| Read interface | Purpose and bounds |
| --- | --- |
| `GET /user-read/sessions` and `/sessions/{id}` | Owner/scoped session metadata, optional first-message preview, exact decimal sequence and analysis metadata. The UI asks for 25 library rows or 5 recent rows. |
| `GET /user-read/projects` | Searchable cursor-paged project choices belonging to the caller. |
| `GET /user-read/sessions/{id}/events` | Cursor-paged history, existing forward behavior plus backward history navigation. The UI requests at most 100 events. |
| `GET /user-read/events/{event_id}` | Event metadata plus up to 50 content sections and `next_sections_cursor`. `section_id` opens a directly linked block; it is mutually exclusive with a sections cursor. |
| `GET /user-read/events/{event_id}/content/{section_id}` | Versioned retained text/Markdown/JSON; default 16,384 characters, maximum 32,768, with `next_cursor` and `complete`. |
| `GET /user-read/events/{event_id}/related` | Cursor-paged input/output references for the selected section, scoped by owner, session, epoch and call ID; may report `indexing_pending`. |
| `GET /user-read/sessions/{id}/events/tail` | Initial latest window or subsequent activations, `tail_cursor`, `history_cursor`, `has_more`, `reset_required` and current analysis metadata. |
| `GET /process/events/search` | Search within indexed event text, with session/type/tool/status filters. |
| `GET /process/sessions/{id}/timeline` and `/process/steps/{id}/evidence` | Paged interpreted steps and supporting source events. |

Read API cursors are opaque and bound to their resource/filter/content version. Do not manufacture or edit them. Inspect `content_version` before displaying a fragment with previously loaded section metadata. Decimal sequence and watermark strings are required for JavaScript; the values can exceed `Number.MAX_SAFE_INTEGER`. Existing numeric fields remain for compatibility with older consumers.

The backend keeps one event per captured transcript row, including rows with multiple Claude blocks. `app/services/transcript_content.py` extracts sections from retained redacted payloads without the parser's preview limits. `process_event_block_refs` indexes every tool block. Migration `0042_transcript_explorer` also adds session event/reset revisions and per-event activation revisions, enabling late-arriving segments and reparse invalidation to be distinguished from ordinary appends.

The live controller performs one network operation at a time, including explicit latest-window reads. It polls visible online HOT sessions every three seconds, drains additional change pages without waiting, and backs off transient failures to a maximum of 30 seconds. Hidden/offline views pause. The current event window is bounded to 100 rows; unchanged responses retain the existing content, and a reset requests a fresh snapshot. A new analysis ID invalidates Process independently of the event history.

Payload contents and credentials must not be recorded in UI analytics or debug logs. Request diagnostics should use status, duration, response size and operation name without storing transcript text or content cursor values. Retention and ownership checks apply to every detail/content/related endpoint, including direct links.

## Verification

Use synthetic fixtures and the configured local test database. Run web/client checks from the Penelopa.ai root:

```sh
npm run typecheck
npm run test:web:unit
npm run test:web
npm run test:web:visual
npm run test:desktop
npm run build
npm run verify:desktop-assets
```

`test:web` includes existing web/demo contracts, `loading-experience.spec.mjs` and `sessions.spec.mjs`. The loading tests cover initial skeletons, reduced motion, refresh failures, recommendation selection races and late desktop responses after logout. Sessions tests cover cursor navigation, source/actor variants, bounded timelines, related tool output, Source data, Process evidence, long fragments, retention states, stable latest snapshots and older desktop compatibility. Controller tests also exercise live serialization, visibility, disposal and reset/history behavior.

The stylesheet contract protects readable theme colors, font tokens, import/cascade boundaries, keyboard focus and reduced-motion overrides. It intentionally does not compare a whole-CSS hash. Review new and changed screenshots in both themes; use narrow layouts and both sides of the 960 px inspector breakpoint. Preserve regression coverage for unaffected demo/legal pages. Do not accept a new screenshot merely because its previous expectation failed.

From the companion backend directory, run the explorer and existing read/process contract suites with its normal test configuration:

```sh
uv run pytest tests/test_transcript_explorer.py tests/test_user_read_api.py tests/test_process_api.py
```

Check both SQLite fixture behavior and PostgreSQL migrations/query paths before release. Backend tests must cover foreign ownership, scoped-token restrictions, expired payloads, multiple tool blocks, Unicode fragment boundaries, late segments, stale/mismatched cursors and reparse resets. Browser fixtures do not establish backend compatibility or native release readiness.

## Release order and operational checks

1. **Backend first.** Deploy the companion `auto-improve/backend` changes with its normal release workflow, including migration `0042_transcript_explorer` (`uv run alembic upgrade head` in the configured backend environment). Validate owner/scoped reads, bounded detail content and the tail/history contract against PostgreSQL before enabling the new web views.
2. **Backfill historical references.** Run bounded batches in that same environment. The command processes unindexed retained events and can be repeated until no eligible backlog remains; the UI reports incomplete indexing while this is in progress.

   ```sh
   uv run auto-improve-backend backfill-transcript-content --batch-size 100 --max-batches 100
   ```

3. **Check the published contract.** Export specs into a temporary/review location and compare DTO fields, prefix mounting and allowlisted query parameters before shipping the client:

   ```sh
   uv run auto-improve-backend export-openapi --output /tmp/penelopa-openapi.json
   uv run auto-improve-backend export-user-read-openapi --output /tmp/penelopa-user-read.openapi.json
   ```

   Authenticated runtime specs are available at backend paths `/api/v1/admin/openapi.json` and `/api/v2/user-read/openapi.json`. The full spec includes Process; the user-read-only spec does not.
4. **Compatible web next.** Publish the tested website after the backend is ready. Verify a real authorized account, long-session navigation, expiry states and an older desktop app's update message. Watch status/error rates, request latency, bytes returned and sustained tail polling; do not log private payloads.
5. **Desktop release last.** Publish a new synchronized immutable desktop version only after macOS arm64/Intel and Windows x64 package/launch, token-isolation and renderer-navigation checks. Follow [desktop delivery](desktop-delivery.md) for Linux hook and clean-machine gates. A website build must not regenerate or replace published desktop artifacts.

If a client rollout must be reverted, keep the additive backend migration and existing v1 behavior available while reverting web/desktop consumers. Do not remove revision/reference columns while deployed workers use them. Pausing a backfill or a frontend release does not require deleting captured data, changing hook configuration or resetting upload queues.

These are release instructions, not a record of executed production commands. No deployment or release publication has occurred in this implementation task.

## Local verification record — 2026-09-09

The website passed TypeScript checking, its production build, 39 unit tests, 35 browser behavior scenarios and 60 visual scenarios. New session screens were inspected in both themes at 390, 768, 1024 and 1440 pixels; reviewed dashboard/report/Telegram baselines were updated for the shared navigation and loading changes. Desktop 1.1.1 passed 57 tests on the pinned Node runtime, release integrity checks, and native macOS arm64 packaging, ad-hoc signing and launch verification.

The companion backend changes are committed as `867f3f5`; its focused explorer/OpenAPI, ingest/storage/retention and compatibility checks passed, along with required pre-commit hooks and SQLite migration/ORM parity. PostgreSQL-specific checks were skipped because `TEST_POSTGRES_URL` was unavailable. Native Windows and macOS Intel verification still require those target environments. Production deployment, migration and historical-content backfill have not been run.
