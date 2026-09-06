# Refactor ledger

This work preserves product behavior, API shapes, persisted data, and public entrypoints. The approved tooling change makes website builds and desktop tests independent of publishing release assets. The standalone `penelopa-how-it-works-demo.html` is an archived design reference; the React demo is maintained.

## Ownership and compatibility

| Area | Maintained source | Generated or compatibility material |
| --- | --- | --- |
| Web routes and shared UI | `app/` | vinext consumes Next-style configuration and generates route types; retain both |
| Animated demo | React component, scenario data, screens and playback | Standalone HTML retained as a reference without continuing parity |
| Desktop app | `desktop/main.cjs`, preloads, local UI and runtime modules | CommonJS, bridge v1 and IPC trust boundaries retained |
| Uploaders | Public POSIX and PowerShell scripts | Platform-specific tools, encoding, durability and legacy configuration paths retained |
| Install/release delivery | Bootstrap templates, generator, pinned release configuration | Public bootstraps, manifests and immutable source ZIPs; never hand-edit generated assets |
| Cloudflare | Vite/Wrangler configuration | `worker-configuration.d.ts` is generated, not a refactor hotspot |

## Review passes

Each implementation checkpoint is a separate local commit, listed below in review order. Each can be reverted independently in reverse dependency order. The original source baseline is `9784ec0`. Characterization assertions were established before the relevant extraction; helper test loaders subsequently switched to the extracted modules without changing expected values.

| Pass / commits | Current behavior preserved | Structural improvement | Validation evidence |
| --- | --- | --- | --- |
| Foundation: `987a449`, `07d6881`, `d47050c`, `9233071` | Existing web, desktop and delivery semantics | Contracts, synthetic fixtures, fixed data/DOM/CSS fingerprints and browser baselines | Original helper/transport/route assertions, desktop orchestration tests, uploader scenarios and browser states |
| 1: `e041b67` | Deterministic packages and stable versioned release URLs | Generator takes source root/output directory; tests/native verification use scratch artifacts; build is website-only | Three artifact tests compare independent generations, current source contents, immutable-release refusal and read-only published integrity |
| 2: `488fae3`, `5d45142` | Unused bindings have no consumed output | Remove confirmed bindings; enable unused-local/parameter TypeScript checks | Typecheck, route smoke checks and desktop suite |
| 3: `7dd2f0d` | List/detail fields, placeholders, clipboard feedback and HTTP errors differ where originally intended | Shared response types/formatters/copy mechanics; existing API error type; inline thin Telegram transport wrapper | 17 fixed helper/transport/public-route tests; browser success/failure/copy states; public proxy runtime output unchanged |
| 4: `a0eb715` | Theme initialization and route-owned browser/desktop gates | Shared theme hook, topbar and token form | Hash/stored/submitted token checks, failure persistence, logout/reconnect, theme persistence and screenshots |
| 5a: `39ad55f` | Summary, chart and recommendation DOM/interactions | Extract dashboard presentation sections | Browser request/series/pagination/expansion/copy checks and dashboard screenshots |
| 5b: `922e82b` | Parallel initial requests, page size 10, report/error state lifetime | Extract dashboard loading and report-interaction hooks | Same request traces and rendered states; independent review of effect order/state ownership |
| 6a: `afca173` | Telegram status, event ordering, expiry rounding and placeholders | Extract pure helpers | Fixed helper assertions across disabled/pending/connected/paused and time boundaries |
| 6b: `67648be` | Draft resets, immediate/two-second polling, focus refresh and mutation order | Extract settings hook without changing the state/effect/action block | Browser expiry, unavailable setup, auth expiry, PATCH-before-POST, 204 reload and two-click disconnect checks |
| 6c: `c84162a` | Compact/full DOM and mode reconciliation | Separate pure view renderers behind the existing export/props | Independent transpiled-JSX comparison, compact/full screenshots and the same interaction checks |
| 7a: `9b9d181` | Both agents' scenario text, steps and initial state | Move typed scenario data | Original complete-data digest and both 25-step sequences |
| 7b: `f6b630e` | Three mounted screens and rendered markup | Extract agent/analysis/recommendation screens | Original initial HTML digests in both themes and screenshots |
| 7c: `8b3abd7` | Playback timing, viewport autoplay, cancellation, scrolling and copy feedback | Isolate playback hook | Controlled-clock checks for both agents, replay, switching, reduced motion, copy failure and unmount |
| 8: `847da82` | Selector specificity, keyframes, media rules and cascade order | Split contiguous CSS into 14 ordered files behind one entrypoint | Expanded source is byte-identical to the original; fixed 432-node ordered CSS digest and 24 screenshot comparisons |
| 9a: `b2ab0f9` | Electron/local-renderer execution order | Expand dense statements | Parsed JS identity before/after formatting plus orchestration tests |
| 9b: `26c4316` | API allowlist, credentials, timeout, 204/null/errors and account expiry | Inject transport dependencies into explicit CommonJS helper | Current-source transport tests; IPC trust checks remain in main |
| 9c: `fd0d752` | Preferences, sign-out, update handoff and lifecycle | Extract local actions with explicit dependencies | Action/IPC/offline/close-to-tray/Quit tests and native macOS arm64 package/launch checks |
| 10a: `0b44540` | Isolated fixtures and Windows ACL commands | Shared temporary fixtures and uncached SID lookup | Same runtime/recovery tests plus injected Windows identity/ACL assertions |
| 10b: `990bd11` | POSIX lock lifetime, global variables and transaction order | Extract repeated locked outbox drain | Shared synthetic delivery scenarios plus platform-specific shell checks |
| 10c: `10d6ea3` | PowerShell lock lifetime, encoding and transaction order | Extract repeated locked outbox drain | Shared scenarios and managed PowerShell offline/ACK/idempotency/Unicode checks |

## Confirmed removals and maintained boundaries

- Web: unused `apiGet` import on notifications; unused `consumeTokenFromHash` import on detail; homepage `API_DOMAIN`; detail's write-only token state/setters.
- Desktop: unused `fs` imports in lifecycle/update and unused `readJson` import in update.
- No reference-count-only file or CSS deletion. The HTML prototype remains intact.
- The dashboard route is now 119 lines, Telegram's public facade 30 lines and the demo wrapper 152 lines. Scenario data and playback mechanics remain separate, named responsibilities. The stylesheet entrypoint retains the original cascade through ordered imports.
- Routes, response/error text, storage keys, installer options, runtime pins, bridge v1, IPC channels, credentials, queue layout and acknowledgement semantics remain unchanged. Recommendation list/detail and Telegram type exports retain their existing distinctions/re-exports.

## Validation and remaining release gates

Local validation uses macOS arm64. The complete desktop suite passes **38/38 without skips** on Node **24.20.0**, including PowerShell execution. Web pure-function/transport/route/demo/CSS tests pass **21/21**. All **40/40 browser checks** pass after the final Telegram extraction. Typechecking and the production website build pass; a before/after content hash comparison found **zero tracked files changed by the build**. The published-asset integrity check also passes without regeneration.

The browser harness uses synthetic API responses, UTC time, a controlled clock, clipboard stubs and explicit intersection events. It covers 16 interaction scenarios and 24 screenshots: home, dashboard, report, Telegram, privacy and terms at 390/1280 pixels in both themes. Font requests are stubbed for deterministic fallback rendering. Screenshot baselines are macOS/Chromium-specific; CI runs interactions on Linux and visual comparisons on macOS. Do not regenerate expectations to approve a changed UI. During baseline QA, the privacy/light/1280 image was corrected because the original capture contained a transient development fetch-error overlay and a broken image. Legal source and expanded CSS were unchanged; image/overlay readiness assertions now reject that invalid baseline condition.

Current-source native packaging passed on macOS arm64 with Node 24.20.0 / Electron 44.2.0: source/archive verification, minimal-PATH packaging, strict ad-hoc signature verification, launch, preload isolation and rendered Connection UI. Retained evidence lives under `/private/tmp/penelopa-build-ehdWIH/`; detailed filenames/hash are in [desktop delivery](desktop-delivery.md). This is local evidence, not evidence of a native Windows or Intel Mac run.

The existing Linux, macOS arm64/Intel and Windows CI matrix now also checks web contracts and rejects tracked-file writes after validation. LF checkout attributes keep byte-sensitive bootstrap/CSS checks stable with Windows `core.autocrlf`. Native Windows, Intel macOS, Linux and the documented clean-consumer-OS checks still need their CI/manual runs before release. No remote CI, release publication or deployment is claimed by this local implementation.

No existing locked dependency version changed. Only Playwright development tooling was installed; PostCSS, already present at the same locked version, is now declared for the CSS contract test. Generated public release artifacts remain intact and pass their read-only integrity check. A later desktop publication must use a new synchronized version and preserve the previous versioned URLs.

## Baseline and deferred migrations

Initial TypeScript check passed. On macOS arm64 / Node 22.22.1, desktop tests passed 25/26 after loopback access was enabled; the managed PowerShell ACK fixture reported a multipart parse error. The same minimal .NET multipart body and all four PowerShell tests pass on pinned Node 24.20.0. This is a Node 22 `Response.formData()` parsing difference; neither uploader behavior nor its ACK fixture needed a change.

Do not combine this work with dependency/framework upgrades, changing floating version policy, CommonJS-to-ESM/TypeScript conversion, a replacement local desktop renderer, uploader unification, compatibility retirement, new auth or polling behavior, queue schema changes, signing changes or deployment redesign. Those require separate migration tasks.
