# Penelopa Recommendations MCP

Local stdio MCP adapter for external agents that need to read and act on a
user's released Penelopa.ai recommendations.

## Configuration

Set the same API token used for the Penelopa dashboard:

```bash
export PENELOPA_API_TOKEN="your-token"
```

`PENELOPA_API_BASE_URL` is optional and defaults to
`https://api.penelopa.ai/v1`.

## Run

```bash
uvx --from git+https://github.com/chigwell/penelopa.ai.git#subdirectory=mcp/penelopa-recommendations penelopa-recommendations-mcp
```

## Tools

- `list_recommendations`
- `read_recommendation`
- `record_recommendation_feedback`

The adapter does not access local transcripts or the internal Hermes task MCP
server. It only calls the public Penelopa REST API with the configured bearer
token.
