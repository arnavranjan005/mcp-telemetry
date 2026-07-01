# mcp-telemetry-server

The collector half of [mcp-telemetry](https://github.com/arnavranjan005/mcp-telemetry). Register it as an MCP server to watch live progress from any tool instrumented with [`mcp-telemetry-sdk`](https://www.npmjs.com/package/mcp-telemetry-sdk).

## Install

```bash
npm install -g mcp-telemetry-server
```

## Register it

```json
{
  "mcpServers": {
    "telemetry": { "command": "npx", "args": ["-y", "mcp-telemetry-server"] }
  }
}
```

## Tools it exposes

| Tool | Behavior |
|---|---|
| `telemetry_subscribe({ jobId?, timeoutMs? })` | Blocks and streams live progress for a job until it finishes. |
| `telemetry_jobs()` | Lists all known jobs with status and cost. |
| `telemetry_job_status({ jobId })` | Full state of one job — steps, cost, failure reason. |

See the [main README](https://github.com/arnavranjan005/mcp-telemetry#quickstart) for a full worked example.

## License

MIT
