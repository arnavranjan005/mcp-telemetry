import { Collector } from '../collector.js';
import { watchJob } from '../subscribe.js';
import type { MonitorEvent } from 'mcp-telemetry-sdk';
import { randomUUID } from 'crypto';

function testSocketPath(): string {
  return `\\\\.\\pipe\\subscribe-test-${randomUUID()}`;
}

const ts = new Date().toISOString();

describe('watchJob', () => {
  it('resolves with the finished message once job_done arrives for the watched job', async () => {
    const collector = new Collector(testSocketPath());
    const notifications: Array<{ message: unknown }> = [];
    const sendNotification = jest.fn(async (n: { method: string; params: Record<string, unknown> }) => {
      notifications.push({ message: n.params.message });
    });

    const promise = watchJob({ collector, jobId: 'j1', deadlineMs: 3000, progressToken: 'tok', sendNotification });

    // Feed events directly through Collector's handler list rather than a
    // real socket — watchJob's own logic is what's under test here, not
    // Collector's NDJSON parsing (already covered by collector.test.ts).
    const handlers = (collector as unknown as { handlers: Array<(e: MonitorEvent) => void> }).handlers;
    handlers.forEach((h) => h({ type: 'job_start', jobId: 'j1', task: 'demo', timestamp: ts }));
    handlers.forEach((h) => h({ type: 'job_done', jobId: 'j1', exitCode: 0, timestamp: ts }));

    const text = await promise;
    expect(text).toBe('Job j1 finished (exit 0).');
    expect(notifications.map((n) => n.message)).toEqual(['▶ demo', '✓ job done (exit 0)']);
  });

  it('ignores events for other job ids', async () => {
    const collector = new Collector(testSocketPath());
    const sendNotification = jest.fn(async () => {});
    const promise = watchJob({ collector, jobId: 'target', deadlineMs: 500, progressToken: 'tok', sendNotification });

    const handlers = (collector as unknown as { handlers: Array<(e: MonitorEvent) => void> }).handlers;
    handlers.forEach((h) => h({ type: 'job_done', jobId: 'other', exitCode: 0, timestamp: ts }));

    const text = await promise; // should time out, not resolve from the wrong job's event
    expect(text).toBe('Timed out waiting for job completion.');
  });

  it('resolves with a timeout message once deadlineMs elapses with no matching job_done', async () => {
    const collector = new Collector(testSocketPath());
    const start = Date.now();
    const text = await watchJob({ collector, jobId: 'never', deadlineMs: 300 });
    expect(text).toBe('Timed out waiting for job completion.');
    expect(Date.now() - start).toBeGreaterThanOrEqual(280);
  });

  it(
    'REGRESSION: awaits the final notification before resolving — the tool response must not ' +
    'reach the client before the job_done tick it is describing',
    async () => {
      const collector = new Collector(testSocketPath());
      const order: string[] = [];

      // A deliberately slow sendNotification — if watchJob resolved without
      // awaiting it (the original bug), the promise below would resolve
      // BEFORE 'notification-sent' gets recorded.
      let releaseNotification: (() => void) | null = null;
      const sendNotification = jest.fn(() => new Promise<void>((resolve) => {
        releaseNotification = () => { order.push('notification-sent'); resolve(); };
      }));

      const promise = watchJob({ collector, jobId: 'j1', deadlineMs: 3000, progressToken: 'tok', sendNotification })
        .then((text) => { order.push('resolved'); return text; });

      const handlers = (collector as unknown as { handlers: Array<(e: MonitorEvent) => void> }).handlers;
      handlers.forEach((h) => h({ type: 'job_done', jobId: 'j1', exitCode: 0, timestamp: ts }));

      await new Promise((r) => setTimeout(r, 100));
      expect(order).toEqual([]); // must not have resolved yet — notification hasn't been "sent"

      releaseNotification!();
      await promise;

      expect(order).toEqual(['notification-sent', 'resolved']);
    },
  );

  it(
    'REGRESSION (Codex review): a slow final notification must not let the deadline timer win — ' +
    'a job that actually finished in time must not be reported as timed out',
    async () => {
      const collector = new Collector(testSocketPath());
      let releaseNotification: (() => void) | null = null;
      const sendNotification = jest.fn(() => new Promise<void>((resolve) => {
        releaseNotification = resolve;
      }));

      // job_done arrives almost immediately, but sending its notification
      // doesn't resolve until well AFTER deadlineMs would have elapsed —
      // the deadline must not be allowed to fire once job_done is observed.
      const promise = watchJob({ collector, jobId: 'j1', deadlineMs: 200, progressToken: 'tok', sendNotification });

      const handlers = (collector as unknown as { handlers: Array<(e: MonitorEvent) => void> }).handlers;
      handlers.forEach((h) => h({ type: 'job_done', jobId: 'j1', exitCode: 0, timestamp: ts }));

      await new Promise((r) => setTimeout(r, 300)); // let the deadline elapse mid-send
      releaseNotification!();

      const text = await promise;
      expect(text).toBe('Job j1 finished (exit 0).');
    },
  );

  it(
    'REGRESSION (Codex review): an event arriving while the final notification is still in flight ' +
    'must not schedule a dangling notification that fires after the tool call already resolved',
    async () => {
      const collector = new Collector(testSocketPath());
      let releaseNotification: (() => void) | null = null;
      const sendNotification = jest.fn(() => new Promise<void>((resolve) => {
        releaseNotification = resolve;
      }));

      // No jobId filter — every event passes the filter, matching the
      // "watch the next job to start" mode where this is reachable.
      const promise = watchJob({ collector, deadlineMs: 3000, progressToken: 'tok', sendNotification });

      const handlers = (collector as unknown as { handlers: Array<(e: MonitorEvent) => void> }).handlers;
      handlers.forEach((h) => h({ type: 'job_done', jobId: 'j1', exitCode: 0, timestamp: ts }));

      await new Promise((r) => setTimeout(r, 50)); // let the async chain reach sendNotification
      handlers.forEach((h) => h({ type: 'log', jobId: 'other-job', line: 'late log', timestamp: ts }));

      releaseNotification!();
      await promise;

      expect(sendNotification).toHaveBeenCalledTimes(1);
      await new Promise((r) => setTimeout(r, 1700)); // past LOG_THROTTLE_MS, catches a dangling timer
      expect(sendNotification).toHaveBeenCalledTimes(1);
    },
    10000,
  );
});
