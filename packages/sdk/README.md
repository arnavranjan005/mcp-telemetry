# @mcp-telemetry/sdk

Zero-dependency instrumentation for MCP servers. Emit `job`/`step`/`log`/`cost` telemetry from your tool handlers; any `@mcp-telemetry/server` (or your own collector) picks it up over a local socket.

Full documentation, architecture, and the companion server: [github.com/arnavranjan005/mcp-telemetry](https://github.com/arnavranjan005/mcp-telemetry)

## Install

```bash
npm install @mcp-telemetry/sdk
```

## Usage

```js
import { MCPTelemetry } from '@mcp-telemetry/sdk';

const telemetry = new MCPTelemetry(); // zero config

server.tool('deploy', schema, async (args) => {
  const job = telemetry.createJob({ task: 'deploy' });
  job.start();
  job.stepStart('build');
  await runBuild();
  job.stepDone('build');
  await job.done(0);
  return { content: [{ type: 'text', text: 'done' }] };
});
```

If nothing is listening on the socket, every call is a fast no-op — this library never throws and never blocks your tool call.

See the [main README](https://github.com/arnavranjan005/mcp-telemetry#api-reference) for the full API reference.

## License

MIT
