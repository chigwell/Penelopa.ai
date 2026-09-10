# Knowledge Graph

The website and desktop share `/dashboard/knowledge-graph`. Graphs are assembled in the client from the user-read API; no backend aggregation, schema migration or generated SDK is added.

## Reading a project

Knowledge Graph appears in dashboard navigation only after an authenticated read finds a run with `node_count > 0`. The probe requests historical runs too (`current_only=false`) and follows cursors through empty pages. Session links independently check that session's availability. Confirmed absence redirects a direct visit to Dashboard; an error does not impersonate an empty account. Older desktop bridges hide navigation and show an update explanation on direct entry.

Choose a project, sources and sessions, then move through the timeline. Each date represents completed analysis (`graph_finished_at`, falling back to `graph_created_at`). A slice is the union of all eligible versions through that time. Later versions never retract earlier knowledge. Historical views restrict provenance and search attributes to what was available by that date. Transcript dates remain visible in the inspector. Repeated observations also appear on the timeline so their additional sources can be inspected.

Entity search highlights matches without removing their graph context. Connection search and relationship filters restrict edges and their endpoints. Selection, filters and dates survive copied links and browser navigation. Session links open the retained session explorer. A responsive inspector becomes a keyboard-accessible modal below 960 px. When WebGL is unavailable, the same searchable entities, relationships and provenance are accessible through a paged list.

## Data and runtime

- Public requests use `https://api.penelopa.ai/v2/user-read`; the backend's `/api` mounting prefix is not repeated. Browser requests use the existing bearer-token transport. Desktop renderer requests carry only an allowlisted path and method; the main process adds credentials.
- The typed client includes list, run detail and current-session shortcut methods. The explorer pages the entire run catalog at 100 items and uses immutable run IDs for graph data. Node/edge streams page independently at 500, with a shared maximum of three active requests. Interrupted project loads resume from their last completed pages.
- A dedicated Web Worker merges entities by project plus Unicode casefolded, whitespace-normalized name, matching backend semantics. Edge endpoints contain labels, not IDs; they resolve against the run's nodes. Direction and normalized relationship form the edge key. Invalid elements are counted and skipped. Original IDs, labels and run/session references are retained.
- Only the active project's raw data and merged graph remain in memory. Logout, account/project changes and navigation dispose requests and workers; late IPC replies cannot repopulate the view. There is no persistent graph cache.
- `@cosmograph/react` and `@cosmograph/cosmograph` are pinned to 2.5.1. A Vite plugin emits the pinned DuckDB 1.32.0 worker and gzip-compressed WASM with the application. The 8.3 MiB compressed WASM stays below the host's asset-size limit; the browser decompresses it before initialization. Graph content is not sent to an external data service. The library's own license/usage services remain subject to its license terms.
- Graph modules load only when needed. Light/dark colors come from existing tokens. Fitting occurs after layout and viewport changes, with enough padding for labels. Manual interaction suppresses a pending simulation-completion camera reset. Matching node IDs preserve positions across data changes. Reduced motion disables camera animation.

## Desktop and release

Desktop 1.1.3 advertises `capabilities.knowledgeGraphRead`. Its main-process allowlist permits only the three graph GET routes and their documented, bounded query parameters. Existing transcript and v1 interfaces stay compatible.

The local release pipeline generated the new source archive, manifest, bootstrap and installer hashes. Older release archives are unchanged. These local files are release candidates; generating them does not publish a website or desktop update.

Commercial deployment requires the appropriate Cosmograph Business license. Set `VITE_COSMOGRAPH_LICENSE_KEY` in the build environment when supplied by the vendor. This is a browser library key, not a user API token. See [Cosmograph licensing](https://cosmograph.app/docs-general/citing-and-licensing/).

Before publishing: verify the authenticated runtime contract against `/api/v2/user-read/openapi.json`, check real account ownership/scoped reads, publish the compatible web build, then release desktop 1.1.3 after native platform checks. Keep existing clients functional. Monitor API failure rate, request sizes and overall load time without recording tokens, graph text or cursor contents. Very large project histories incur complete client-side download and aggregation costs in v1.

## Verification

```sh
npm run typecheck
npm run test:web:unit
npm run test:web
npm run test:web:visual
npm run build
npm run test:web:production
npm run test:desktop
npm run verify:desktop-assets
npm run verify:desktop-build
```

Run desktop tests using the release-pinned Node 24.20.0; the system's Node 22 multipart parser is incompatible with existing PowerShell upload fixtures.

Production tests exercise the compiled worker and local WASM through Wrangler, including actual WebGL in both themes, a single isolated entity and 1,200 disconnected entities. To also run the native graph test, set `PENELOPA_TEST_ELECTRON` to the release-pinned Electron executable (44.2.0). The native fixture runs the real desktop preload and request validator with synthetic API data, context isolation and sandboxing. It never reads an installed account token.

Screenshot fixtures cover both themes at 390, 768, 1024 and 1440 px, including the inspector. Graph correctness tests cover cumulative history, name normalization, provenance, source filters, pagination, cancellation, retries, access errors and old desktop compatibility. Native packaging and actual production account checks are separate from mocked API tests.

### Local verification — 2026-09-10

- Typecheck, production build and release-asset integrity checks passed.
- All 49 web unit tests and 58 desktop tests passed (desktop tests used pinned Node 24.20.0).
- All 11 production graph scenarios passed, including real WebGL/local WASM and the native Electron preload integration. Graph data in these tests was synthetic.
- All eight responsive visual scenarios passed against 16 reviewed screenshots. Existing browser regression scenarios passed; the two initial failures were corrected and their affected suites rerun successfully.
- The macOS Apple Silicon desktop package was built and signed locally. Its isolated launch smoke test passed on retry after the first launch exceeded the harness timeout. Electron 44.2.0 also rendered the graph against the compiled production preview.
- Publishing was not performed. Authenticated checks against a real API account, the commercial license configuration and native Windows/macOS Intel verification remain release requirements.
