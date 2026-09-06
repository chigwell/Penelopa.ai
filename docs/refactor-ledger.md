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

Each implementation checkpoint is a separate commit. Validation compares against expectations captured before production changes. Update this table as checkpoints finish; a passing local test is not evidence of a native Windows or Intel Mac check.

| Pass | Behavior contract | Structural change | Required evidence | Status |
| --- | --- | --- | --- | --- |
| Foundation | Existing web, desktop and delivery semantics | Contracts and characterization fixtures | Original tests, CSS/data/DOM fingerprints, browser screenshots | In progress |
| 1 | Deterministic source packages and stable release URLs | Scratch test/native artifacts; explicit publishing | Byte equality, source freshness, published hashes, clean tracked assets | Pending |
| 2 | No consumed output changes | Remove confirmed unused imports/constants/state; enable unused checks | Typecheck and existing page contracts | Pending |
| 3 | Formatting, clipboard, HTTP and response shapes | Shared types/helpers; remove thin Telegram wrapper | Fixed helper and transport assertions | Pending |
| 4 | Route-specific auth and theme behavior | Shared presentation and theme hook | Browser auth/theme/clipboard checks and screenshots | Pending |
| 5 | Dashboard request order and interactions | Views, data loading and report hooks | Request traces, pagination, expansion, chart checks | Pending |
| 6 | Telegram drafts, transitions and polling | Helpers, state hook, compact/full views | Timer/mutation/auth/expiry/disconnect checks | Pending |
| 7 | Demo scenes, timing and cancellation | Data, screen and playback extractions | Original data/SSR fingerprints and browser scenarios | Pending |
| 8 | CSS cascade and rendering | Contiguous ordered stylesheets | Original ordered AST fingerprint and screenshots | Pending |
| 9 | Electron trust and lifecycle | Explicit API/action helpers | IPC/action tests and native smoke | Pending |
| 10 | Installer ownership and durable upload delivery | Shared test fixtures/SID lookup and uploader helpers | Synthetic protocol and rollback tests, native matrix | Pending |

## Baseline and deferred migrations

Initial TypeScript check passed. On macOS arm64 / Node 22.22.1, desktop tests passed 25/26 after loopback access was enabled; the managed PowerShell ACK fixture reported a multipart parse error. Reproduce with pinned Node 24.20.0 before changing delivery behavior; fix a demonstrated test defect separately from product changes.

Do not combine this work with dependency/framework upgrades, changing floating version policy, CommonJS-to-ESM/TypeScript conversion, a replacement local desktop renderer, uploader unification, compatibility retirement, new auth or polling behavior, queue schema changes, signing changes or deployment redesign. Those require separate migration tasks.
