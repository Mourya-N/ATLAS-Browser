# Local MCP Tool Server

Implemented in `src/main/mcp/mcp-server.ts`.

## Security Defaults

- **Disabled by default** (`enabled: false`). Must be explicitly activated by the user in **Menu → Local MCP Server**.
- **Localhost-only binding**: Binds strictly to `127.0.0.1` (default port `47291`).
- **Authentication**: Requires `Authorization: Bearer <token>` verified via `crypto.timingSafeEqual` against an encrypted token in `SecretVault`. Tokens can be rotated at any time.
- **Rate Limiting & Allowlist**: Enforces a sliding-window per-minute rate limit and restricts calls to allowlisted tools (`list_tabs`, `read_tab`, `navigate`, `search_tabs`, `extract_content`, `run_task`, `get_task_status`, `stop_task`).
- **Private Tab Isolation**: Private tabs are excluded from `list_tabs`, `search_tabs`, and `read_tab`.
- **Audit Logging**: All requests, auth failures, denied tools, and token rotations are recorded in `audit_events`.

## Example JSON-RPC Call

```bash
curl -X POST http://127.0.0.1:47291/mcp \
  -H "Authorization: Bearer <YOUR_LAVRAY_MCP_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"id":1,"method":"tools/call","params":{"name":"list_tabs","arguments":{}}}'
```
