# Penelopa.ai

Cloudflare Workers Next.js application powered by vinext.

## Commands

- `npm run dev` starts local development.
- `npm run build` creates production Worker output.
- `npm run start` runs the built Worker locally.
- `npm run deploy` builds and deploys to Cloudflare Workers.

## Public Hook Installers

- `https://penelopa.ai/script` serves the POSIX shell installer.
- `https://penelopa.ai/script.ps1` serves the PowerShell installer.
- Both installers write the public ingest endpoint `https://api.penelopa.ai/v2/transcript-segments` unless the user overrides it.
- The installers still require an API token via `--token`, `-Token`, `AUTO_IMPROVE_TOKEN`, or `API_ACCESS_TOKEN` in the current directory's `.env`.

## Deployment

The Worker is configured as `penelopa-ai` and deploys on the existing `penelopa.ai/*` Cloudflare route.

Before the first deploy, authenticate Wrangler with `wrangler login` or provide `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the environment. The `penelopa.ai` zone must already exist in the selected Cloudflare account, and the DNS record for `penelopa.ai` must be proxied through Cloudflare.
