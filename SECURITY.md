# Security Policy

## Reporting a vulnerability

Please do **not** open a public GitHub issue for security vulnerabilities.

Instead, email **arnavranjan005@gmail.com** with:

- A description of the issue and its potential impact
- Steps to reproduce (a minimal repro is ideal)
- Any suggested fix, if you have one

You should receive a response within a few days. Once a fix is available, a security advisory will be published and credit given to the reporter, unless you prefer to remain anonymous.

## Supported versions

This project is pre-1.0. Only the latest published version of each package (`@mcp-telemetry/sdk`, `@mcp-telemetry/server`) receives security fixes.

## Known scope of this project

`mcp-telemetry` uses an unauthenticated local socket (a named pipe on Windows, a Unix domain socket on Linux/macOS) for producer→collector communication. The socket path is derived deterministically from a working-directory hash (`getSocketPath()`), which is **not a secret** — any process on the same machine that can compute or guess the same hash can connect and write arbitrary events into a running collector's job store.

This is an accepted design trade-off for a local development tool, not an oversight: the threat model assumes a single-user machine where anything capable of writing telemetry could equally just run your MCP server directly. If you plan to run `@mcp-telemetry/server` in a genuinely multi-tenant or shared-machine environment, treat that as out of scope for the current design and please open an issue to discuss before relying on it there.
