import type { MonitorEvent } from 'mcp-telemetry-sdk';
import type { Collector } from './collector.js';
import { formatEvent } from './format.js';

export type SendNotification = (notification: { method: string; params: Record<string, unknown> }) => Promise<void>;

export interface WatchJobOptions {
  collector: Collector;
  jobId?: string;
  deadlineMs: number;
  progressToken?: string | number;
  sendNotification?: SendNotification;
}

const LOG_THROTTLE_MS = 1500;
const LOG_BATCH_MAX = 20;

// Extracted from the telemetry_subscribe tool handler so its notification-
// ordering behavior can be unit tested directly, without going through the
// full stdio/MCP protocol stack. Resolves with the final result text once
// the watched job's job_done event arrives, or once deadlineMs elapses.
export function watchJob(opts: WatchJobOptions): Promise<string> {
  const { collector, jobId, deadlineMs, progressToken, sendNotification } = opts;

  return new Promise((resolve) => {
    let n = 0;
    let settled = false;
    let pendingLogs: string[] = [];
    let logTimer: ReturnType<typeof setTimeout> | null = null;

    // Returns the send's own promise — callers that resolve the tool call
    // right after pushing (the job_done path) must await it first, or the
    // final tool response can reach the client before this notification's
    // write even goes out, and the client sees the result with no
    // corresponding final tick.
    const push = (message: string): Promise<void> => {
      n += 1;
      if (progressToken === undefined || !sendNotification) return Promise.resolve();
      return sendNotification({
        method: 'notifications/progress',
        params: { progressToken, progress: n, message },
      }).catch(() => {});
    };

    // Raw log lines are usually too frequent to push one-by-one (a verbose
    // run can emit hundreds) — coalesce them into one notification every
    // LOG_THROTTLE_MS or LOG_BATCH_MAX lines, whichever comes first.
    // Structured events (step/cost/done) always flush any pending logs
    // first so ordering in the stream matches what actually happened, then
    // push immediately themselves — they're infrequent enough not to need
    // throttling.
    const flushLogs = (): Promise<void> => {
      if (logTimer) { clearTimeout(logTimer); logTimer = null; }
      if (!pendingLogs.length) return Promise.resolve();
      const message = pendingLogs.join('\n');
      pendingLogs = [];
      return push(message);
    };

    // Async so every caller that needs the final response to arrive AFTER
    // the last notification (both callers below) can await it — resolving
    // the tool call is what ends the whole exchange, so anything not yet
    // sent by that point risks never reaching the client at all.
    const finish = async (text: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      await flushLogs();
      collector.offEvent(handler);
      resolve(text);
    };

    const handler = async (event: MonitorEvent) => {
      if (jobId && event.jobId !== jobId) return;

      if (event.type === 'log') {
        pendingLogs.push(formatEvent(event));
        if (pendingLogs.length >= LOG_BATCH_MAX) { await flushLogs(); return; }
        if (!logTimer) logTimer = setTimeout(flushLogs, LOG_THROTTLE_MS);
        return;
      }

      await flushLogs();
      await push(formatEvent(event));
      if (event.type === 'job_done') {
        await finish(`Job ${event.jobId} finished (exit ${event.exitCode}).`);
      }
    };

    collector.onEvent(handler);
    const timer = setTimeout(() => finish('Timed out waiting for job completion.'), deadlineMs);
  });
}
