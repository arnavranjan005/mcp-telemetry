import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getSocketPath } from '@mcp-telemetry/sdk';
import type { MonitorEvent } from '@mcp-telemetry/sdk';
import { Collector } from './collector.js';
import { JobStore } from './store.js';
import { formatEvent, formatJob } from './format.js';

const JOBS_RESOURCE_URI = 'telemetry://jobs';

const store = new JobStore();
const collector = new Collector(getSocketPath());
const server = new McpServer({ name: 'mcp-telemetry', version: '0.1.0' });

// ── Tools ─────────────────────────────────────────────────────────────────────

server.tool(
  'telemetry_jobs',
  'List all active and recently completed jobs across all connected MCP servers.',
  {},
  async () => {
    const jobs = store.getJobs();
    if (!jobs.length) return { content: [{ type: 'text', text: 'No jobs yet.' }] };
    const lines = jobs.map((j) => {
      const icon = { completed: '✓', failed: '✗', input_required: '!', working: '↻', cancelled: '⊘' }[j.status];
      const cost = j.totalCost > 0 ? `  $${j.totalCost.toFixed(4)}` : '';
      return `${icon} [${j.jobId}] ${j.task}${cost}`;
    });
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  },
);

server.tool(
  'telemetry_job_status',
  'Get the full status of a specific job — all steps, cost, and any failure reason.',
  { jobId: z.string().describe('Job ID returned by job_start event or telemetry_jobs.') },
  async ({ jobId }) => {
    const job = store.getJob(jobId);
    if (!job) return { content: [{ type: 'text', text: `No job found: ${jobId}` }], isError: true };
    return { content: [{ type: 'text', text: formatJob(job) }] };
  },
);

server.tool(
  'telemetry_subscribe',
  'Watch live job events as they happen — blocks and streams inline progress until the job (or, with no jobId, the next job) finishes, or until timeoutMs elapses.',
  {
    jobId: z.string().optional().describe('Watch only this job. Omit to watch the next job to start.'),
    timeoutMs: z.number().optional().describe('Give up and return after this many ms. Default 5 minutes.'),
  },
  async ({ jobId, timeoutMs }, extra) => {
    const progressToken = extra._meta?.progressToken;
    const deadline = timeoutMs ?? 5 * 60 * 1000;
    const LOG_THROTTLE_MS = 1500;
    const LOG_BATCH_MAX = 20;

    return new Promise((resolve) => {
      let n = 0;
      let settled = false;
      let pendingLogs: string[] = [];
      let logTimer: ReturnType<typeof setTimeout> | null = null;

      const push = (message: string) => {
        n += 1;
        if (progressToken !== undefined) {
          extra.sendNotification({
            method: 'notifications/progress',
            params: { progressToken, progress: n, message },
          }).catch(() => {});
        }
      };

      // Raw log lines are usually too frequent to push one-by-one (a verbose
      // run can emit hundreds) — coalesce them into one notification every
      // LOG_THROTTLE_MS or LOG_BATCH_MAX lines, whichever comes first.
      // Structured events (step/cost/done) always flush any pending logs
      // first so ordering in the stream matches what actually happened, then
      // push immediately themselves — they're infrequent enough not to need
      // throttling.
      const flushLogs = () => {
        if (logTimer) { clearTimeout(logTimer); logTimer = null; }
        if (!pendingLogs.length) return;
        push(pendingLogs.join('\n'));
        pendingLogs = [];
      };

      const finish = (text: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        flushLogs();
        collector.offEvent(handler);
        resolve({ content: [{ type: 'text', text }] });
      };

      const handler = (event: MonitorEvent) => {
        if (jobId && event.jobId !== jobId) return;

        if (event.type === 'log') {
          pendingLogs.push(formatEvent(event));
          if (pendingLogs.length >= LOG_BATCH_MAX) { flushLogs(); return; }
          if (!logTimer) logTimer = setTimeout(flushLogs, LOG_THROTTLE_MS);
          return;
        }

        flushLogs();
        push(formatEvent(event));
        if (event.type === 'job_done') {
          finish(`Job ${event.jobId} finished (exit ${event.exitCode}).`);
        }
      };

      collector.onEvent(handler);
      const timer = setTimeout(() => finish('Timed out waiting for job completion.'), deadline);
    });
  },
);

// ── Resource — auto-push via MCP resource subscriptions ───────────────────────

server.resource(
  'telemetry-jobs',
  JOBS_RESOURCE_URI,
  { description: 'Live job state for all connected MCP servers. Subscribe to receive updates.' },
  async () => ({
    contents: [{
      uri: JOBS_RESOURCE_URI,
      mimeType: 'application/json',
      text: JSON.stringify(store.getJobs(), null, 2),
    }],
  }),
);

// ── Collector → store → notify all subscribed agents ─────────────────────────

collector.onEvent((event) => {
  store.apply(event);
  // Push resource update notification — agents that subscribed to telemetry://jobs
  // will be notified and can re-read the resource to get the latest state.
  server.server.notification({
    method: 'notifications/resources/updated',
    params: { uri: JOBS_RESOURCE_URI },
  }).catch(() => {});
});

const pruneTimer = setInterval(() => store.prune(), 5 * 60 * 1000);
pruneTimer.unref();

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function main() {
  await collector.listen();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = () => { collector.close(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => { console.error(err); process.exit(1); });

