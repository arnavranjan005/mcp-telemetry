import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { randomUUID } from 'crypto';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const SERVER_BIN = path.resolve(__dirname, '../../packages/server/bin/server.js');

interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

export interface McpTestClient {
  notifications: JsonRpcMessage[];
  cwd: string;
  request(method: string, params?: Record<string, unknown>, meta?: Record<string, unknown>): Promise<unknown>;
  notify(method: string, params?: Record<string, unknown>): void;
  waitForNotifications(count: number, timeoutMs?: number): Promise<void>;
  close(): void;
}

let nextId = 1;

// Spawns the REAL compiled server binary (packages/server/bin/server.js) as a
// separate process, exactly as a real MCP client would — this is the actual
// artifact that ships, not a reimport through the test runner. `cwd` controls
// the socket path (getSocketPath derives it from cwd), so a fresh unique temp
// dir per test guarantees no cross-test pipe collisions.
export function startMcpTelemetryServer(): McpTestClient {
  const cwd = mkdtempSync(path.join(tmpdir(), 'mcp-telemetry-e2e-'));
  const proc: ChildProcessWithoutNullStreams = spawn(process.execPath, [SERVER_BIN], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  const notifications: JsonRpcMessage[] = [];
  let buf = '';

  proc.stdout.on('data', (chunk: Buffer) => {
    buf += chunk.toString();
    let idx: number;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      let msg: JsonRpcMessage;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id)!;
        pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        notifications.push(msg);
      }
    }
  });

  function request(method: string, params: Record<string, unknown> = {}, meta?: Record<string, unknown>): Promise<unknown> {
    const id = nextId++;
    const finalParams = meta ? { ...params, _meta: meta } : params;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params: finalParams }) + '\n');
    });
  }

  function notify(method: string, params: Record<string, unknown> = {}): void {
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  function waitForNotifications(count: number, timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
      const poll = () => {
        if (notifications.length >= count) { resolve(); return; }
        if (Date.now() > deadline) {
          reject(new Error(`waitForNotifications: only got ${notifications.length}/${count} within ${timeoutMs}ms`));
          return;
        }
        setTimeout(poll, 20);
      };
      poll();
    });
  }

  function close(): void {
    proc.kill();
  }

  return { notifications, cwd, request, notify, waitForNotifications, close };
}

export async function initializeMcp(client: McpTestClient): Promise<void> {
  await client.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'jest-e2e', version: '0.0.1' },
  });
  client.notify('notifications/initialized');
  // Give the server a beat to finish its own startup (collector.listen()) —
  // initialize() replying doesn't guarantee the socket is already bound.
  await new Promise((r) => setTimeout(r, 150));
}

export function progressNotifications(client: McpTestClient): Array<{ progress: number; message: string }> {
  return client.notifications
    .filter((n) => n.method === 'notifications/progress')
    .map((n) => (n.params as { progress: number; message: string }));
}
