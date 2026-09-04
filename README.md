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
- On first run, the installers request a public token from `https://api.penelopa.ai/v1/auth/bootstrap-token`, print it, and save it in the local hook config.
- After every successful install, the installers print a private dashboard link using `#token=...` and try to print a Telegram bot setup link.
- Re-running the installer reuses the saved hook token by default. In an interactive terminal it asks before replacing it; use `--force-new-token` or `-ForceNewToken` to skip the prompt and request a fresh token.
- `--token`, `-Token`, `AUTO_IMPROVE_TOKEN`, or `API_ACCESS_TOKEN` in the current directory's `.env` still work as explicit overrides for private or local deployments.

## Deployment

The Worker is configured as `penelopa-ai` and deploys on the `penelopa.ai` Cloudflare Worker Custom Domain. The `workers.dev` URL is enabled for deployment checks.

Before the first deploy, authenticate Wrangler with `wrangler login` or provide `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the environment. The `penelopa.ai` zone must already exist in the selected Cloudflare account.
