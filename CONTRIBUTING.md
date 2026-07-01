# Contributing to mcp-telemetry

Thanks for considering a contribution. This project is small on purpose — please read the design notes in [README.md](README.md#design-notes-worth-knowing-before-you-rely-on-this) before proposing anything that adds persistence, retries, or cross-machine delivery. Those are deliberate non-goals, not gaps.

## Getting set up

```bash
git clone https://github.com/arnavranjan005/mcp-telemetry.git
cd mcp-telemetry
npm install
npm run build
npm test
```

`npm test` runs a full rebuild first (`pretest`), then the complete Jest suite across all three projects: `sdk` unit tests, `server` unit tests, and `e2e` (spawns the real compiled server binary and drives it over stdio, exactly like a real MCP client would).

## Repo layout

```
mcp-telemetry/
├── packages/
│   ├── sdk/                  → mcp-telemetry-sdk (the instrumentation library)
│   │   └── src/
│   │       ├── index.ts      → MCPTelemetry (public entry point)
│   │       ├── job.ts        → JobHandle
│   │       ├── connection.ts → QueuedConnection (persistent socket + retry/backoff)
│   │       └── protocol.ts   → MonitorEvent types, getSocketPath()
│   └── server/                → mcp-telemetry-server (the collector + MCP tools)
│       └── src/
│           ├── index.ts      → MCP tool definitions, bootstrap
│           ├── collector.ts  → NDJSON socket listener
│           ├── store.ts      → in-memory JobStore
│           └── format.ts     → event/job formatting for tool output
├── test/e2e/                  → cross-package end-to-end tests
└── jest.config.cjs            → three-project Jest config (sdk / server / e2e)
```

Both packages compile with `tsc` to NodeNext ESM for the real build (`npm run build`). Tests run through `ts-jest` with an inline CommonJS override instead, so Jest never has to deal with native ESM — this doesn't affect what ships.

## Making a change

1. Open an issue first for anything beyond a small fix — see [design notes](README.md#design-notes-worth-knowing-before-you-rely-on-this) for what's in scope.
2. Add or update tests for any behavior change. A PR that changes `connection.ts`, `collector.ts`, or `store.ts` without a corresponding test will be asked to add one.
3. Run `npm test` locally before opening the PR — CI runs the same suite on Ubuntu and Windows (this project deals directly with OS-level sockets/named pipes, so cross-platform behavior is not optional).
4. Keep the SDK dependency-free. `mcp-telemetry-sdk` has zero runtime dependencies and no MCP-specific concepts in it (no `progressToken`, no `sendNotification`) — that's load-bearing, not an oversight. Anything MCP-protocol-specific belongs in `mcp-telemetry-server`.
5. Match the existing comment style: comments explain *why*, not *what*. If a comment just restates the code, it should probably be deleted instead of added.

## Commit messages

No enforced format, but a commit message should explain why the change was made, not just what changed — the diff already shows what changed.

## Reporting bugs / requesting features

Use the issue templates. For security issues, see [SECURITY.md](SECURITY.md) instead of opening a public issue.
