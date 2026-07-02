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

    // The single place that ends the exchange. Claims "done" synchronously
    // (settled + clearTimeout, no await in between) before doing anything
    // else — that's what makes it race-proof against the deadline timer:
    // once this line has run, the timer literally cannot win anymore,
    // regardless of how long flushing/pushing the final notification takes.
    // This is also why the job_done notification is sent from HERE rather
    // than by the caller beforehand — sending it first, outside this guard,
    // is exactly what left the deadline free to fire in the gap.
    const finish = async (text: string, finalMessage?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      await flushLogs();
      if (finalMessage !== undefined) await push(finalMessage);
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

      if (event.type === 'job_done') {
        await finish(`Job ${event.jobId} finished (exit ${event.exitCode}).`, formatEvent(event));
        return;
      }

      await flushLogs();
      await push(formatEvent(event));
    };

    collector.onEvent(handler);
    const timer = setTimeout(() => finish('Timed out waiting for job completion.'), deadlineMs);
  });
}
