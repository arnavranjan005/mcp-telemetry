# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-07-02

### Added
- `mcp-telemetry-sdk`: `MCPTelemetry` client with a persistent, queued `QueuedConnection` (replaces an earlier connect-per-event design) — events queue in order and flush once connected, survive a failed connect if a later event triggers a retry, and cap at 1000 queued entries under sustained backpressure.
- `mcp-telemetry-sdk`: `JobHandle` lifecycle — `start()`, `stepStart()`, `stepDone()`, `stepFailed()`, `log()` (with optional `stdout`/`stderr` tagging), `cost()`, and `done()`.
- `mcp-telemetry-sdk`: `done()` actively drains the connection for up to 1.5s instead of relying on a future event to retry — closes a gap where the terminal `job_done` event could be silently lost if nothing was sent after it.
- `mcp-telemetry-sdk`: `getSocketPath()` normalizes (resolves, and on Windows lowercases) the root path before hashing, so producers and the collector can't silently land on different sockets due to path casing/trailing-slash differences.
- `mcp-telemetry-server`: `telemetry_subscribe` tool — blocks and streams live `notifications/progress` for a job via its `progressToken`, coalescing rapid `log` events (1.5s / 20-line batches) while pushing structured events (steps, cost, done) immediately.
- `mcp-telemetry-server`: `telemetry_jobs` and `telemetry_job_status` tools for point-in-time queries.
- Full Jest test suite: unit tests for both packages plus an end-to-end suite that spawns the real compiled server binary and drives it over stdio.

[0.1.0]: https://github.com/arnavranjan005/mcp-telemetry/releases/tag/v0.1.0
