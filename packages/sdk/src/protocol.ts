import { createHash } from 'crypto';
import { join, resolve } from 'path';

// Aligned with MCP Tasks extension (SEP-2663) state names
export type TaskStatus = 'working' | 'input_required' | 'completed' | 'failed' | 'cancelled';

export type MonitorEvent =
  | { type: 'job_start';   jobId: string; task: string;                                   timestamp: string }
  | { type: 'job_done';    jobId: string; exitCode: number;                                timestamp: string }
  | { type: 'step_start';  jobId: string; step: string;  meta?: Record<string, unknown>;  timestamp: string }
  | { type: 'step_done';   jobId: string; step: string;  meta?: Record<string, unknown>;  timestamp: string }
  | { type: 'step_failed'; jobId: string; step: string;  reason?: string;                 timestamp: string }
  | { type: 'log';         jobId: string; line: string; stream?: 'stdout' | 'stderr';      timestamp: string }
  | { type: 'cost';        jobId: string; amount: number; meta?: Record<string, unknown>; timestamp: string };

export function getSocketPath(root = process.cwd()): string {
  // Resolve (and, on Windows, lowercase) so callers pointing at the same
  // directory always hash to the same pipe/socket regardless of trailing
  // slashes or drive-letter casing — a mismatch here silently splits
  // producers and the collector onto two different sockets with no error
  // on either side. Unix paths stay case-sensitive.
  const resolved = resolve(root);
  if (process.platform === 'win32') {
    const hash = createHash('md5').update(resolved.toLowerCase()).digest('hex').slice(0, 8);
    return `\\\\.\\pipe\\mcp-telemetry-${hash}`;
  }
  return join(resolved, '.mcp-telemetry.sock');
}
