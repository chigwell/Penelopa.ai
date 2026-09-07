import type { Metadata } from "next";
import Image from "next/image";

const PACKAGE_SOURCE =
  "git+https://github.com/chigwell/auto-improve.git#subdirectory=mcp/penelopa-recommendations";

const UVX_COMMAND =
  `uvx --from ${PACKAGE_SOURCE} penelopa-recommendations-mcp`;

const CODEX_CONFIG = `[mcp_servers.penelopa_recommendations]
command = "uvx"
args = [
  "--from",
  "${PACKAGE_SOURCE}",
  "penelopa-recommendations-mcp",
]

[mcp_servers.penelopa_recommendations.env]
PENELOPA_API_TOKEN = "paste-your-token"`;

const CLAUDE_CONFIG = `{
  "mcpServers": {
    "penelopa-recommendations": {
      "command": "uvx",
      "args": [
        "--from",
        "${PACKAGE_SOURCE}",
        "penelopa-recommendations-mcp"
      ],
      "env": {
        "PENELOPA_API_TOKEN": "paste-your-token"
      }
    }
  }
}`;

export const metadata: Metadata = {
  title: "Recommendations MCP | Penelopa.ai",
  description: "Install the local Penelopa.ai recommendations MCP adapter for external agents.",
};

export default function McpPage() {
  return (
    <main className="legal-shell mcp-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="/" aria-label="Penelopa.ai home">
            <span className="brand-mark" aria-hidden="true">
              <Image
                src="/penelopa-ai.png"
                alt=""
                width={42}
                height={42}
                priority
                className="brand-logo"
              />
            </span>
            <span className="brand-name">Penelopa.ai</span>
          </a>
          <div className="topbar-actions">
            <a className="dashboard-link" href="/">
              Home
            </a>
            <a className="dashboard-link" href="/dashboard">
              Dashboard
            </a>
          </div>
        </div>
      </header>

      <article className="legal-main mcp-main">
        <header className="legal-heading">
          <p className="eyebrow">MCP / Recommendations</p>
          <h1>Recommendations MCP.</h1>
          <p>Local stdio adapter for external agents</p>
        </header>

        <section className="legal-document mcp-document" aria-label="Recommendations MCP setup">
          <p>
            Run this local MCP server when an agent should read your released Penelopa.ai
            recommendations through the same API token used by the dashboard.
          </p>

          <h2>Install command</h2>
          <pre>
            <code>{UVX_COMMAND}</code>
          </pre>

          <h2>Codex config</h2>
          <pre>
            <code>{CODEX_CONFIG}</code>
          </pre>

          <h2>Claude config</h2>
          <pre>
            <code>{CLAUDE_CONFIG}</code>
          </pre>

          <h2>Tools</h2>
          <ul>
            <li>
              <code>list_recommendations</code> returns a paginated list of released
              recommendations.
            </li>
            <li>
              <code>read_recommendation</code> returns the full markdown report for one
              recommendation.
            </li>
            <li>
              <code>record_recommendation_feedback</code> records explicit feedback such as
              useful, implemented, already exists, or not suitable.
            </li>
          </ul>

          <h2>Security boundary</h2>
          <p>
            The adapter keeps your token in the local agent process and calls
            <code>https://api.penelopa.ai/v1</code>. It does not read local transcripts, does
            not connect to the internal Hermes task MCP server, and can only access
            recommendations visible to that API token.
          </p>

          <p>
            Set <code>PENELOPA_API_BASE_URL</code> only when testing against another compatible
            Penelopa API host.
          </p>
        </section>
      </article>

      <footer className="site-footer">
        <div className="site-footer-inner">
          <p>Copyright 2026 Penelopa.ai. Made by Eugene Evstafev.</p>
          <nav className="footer-links" aria-label="Site links">
            <a href="/mcp">MCP</a>
            <a href="/privacy">Privacy Policy</a>
            <a href="/terms">Terms of Service</a>
            <a href="mailto:support@penelopa.ai">support@penelopa.ai</a>
          </nav>
        </div>
      </footer>
    </main>
  );
}
