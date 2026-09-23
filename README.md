# n8n-nodes-singapore-proxy

[![CI](https://github.com/Xavierfok/n8n-nodes-singapore-proxy/actions/workflows/ci.yml/badge.svg)](https://github.com/Xavierfok/n8n-nodes-singapore-proxy/actions/workflows/ci.yml)

An [n8n](https://n8n.io/) community node that fetches web pages and runs Google searches **from a real Singapore mobile IP**, on the Singtel or M1 network. Use it in a workflow, or give it to an n8n AI Agent as a tool.

It calls the hosted [Singapore Proxy MCP server](https://github.com/Xavierfok/singapore-proxy-mcp) (`https://mcp.singaporemobileproxy.com/mcp`). You don't run a proxy or a browser yourself.

## Operations

| Operation | What it does |
|-----------|--------------|
| **Fetch URL** | Fetch a page through a Singapore mobile IP. Returns markdown (default), text or HTML. |
| **Google Search** | Google organic results with `gl=sg`, searched from a Singapore IP. |
| **Rotate IP** | Get a fresh Singapore mobile IP. |
| **Get Status** | Current exit IP, carrier and remaining quota. |

Each item comes out as `{ "operation": "...", "result": "..." }`. With **Continue On Fail** on, a failed item comes out as `{ "error": "..." }` instead.

Typical uses: checking Singapore prices and stock, local SERP and ad checks, pulling pages that are geo-locked to Singapore, and giving an AI Agent a way to browse as a Singapore user.

## Installation

In n8n: **Settings → Community Nodes → Install**, then enter `n8n-nodes-singapore-proxy`. See n8n's [community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/).

## Credentials

1. Get an API key at **[singaporemobileproxy.com/client/mcp](https://singaporemobileproxy.com/client/mcp?utm_source=github&utm_medium=repo&utm_campaign=n8n_nodes_singapore_proxy)**. A new key comes with a free 24-hour trial capped at 10 GB, one per email.
2. In n8n, create a **Singapore Proxy API** credential and paste the key.

The credential test runs a real status check, so a wrong or expired key fails there instead of mid-workflow.

After the trial the same key keeps working on a paid plan: $4 for a day, $13 for a week, or monthly from $40 ([plans](https://singaporemobileproxy.com/client/plans?days=1&utm_source=github&utm_medium=repo&utm_campaign=n8n_nodes_singapore_proxy)).

## Notes

- Each key sits on a dedicated 4G line on the Singtel or M1 network. There's no StarHub stock right now.
- One node run uses one MCP session for all its items. If the server drops the session, the node opens a new one and retries once.
- Requests go through a modem, so the timeout is 120 s per call.
- The node has no runtime dependencies.

## Development

```bash
npm install
npm run lint
npm test        # builds, then runs the tests in test/ against dist/
npm run dev     # starts a local n8n with the node loaded
```

The tests fake the HTTP layer. The operation-to-tool mapping was checked against the live server's `tools/list`, and the credential test was run against the live server with an invalid key.

## Related

- [singapore-proxy-mcp](https://github.com/Xavierfok/singapore-proxy-mcp): the same key in Claude, Cursor and other MCP clients
- [langchain-singapore-proxy](https://github.com/Xavierfok/langchain-singapore-proxy): LangChain tools
- [scrapy-sg-proxy](https://github.com/Xavierfok/scrapy-sg-proxy): Scrapy middleware

## License

MIT. Not affiliated with n8n, Google or any carrier.
