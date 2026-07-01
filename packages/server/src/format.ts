import type { MonitorEvent } from '@mcp-telemetry/sdk';
import type { JobState } from './store.js';

export function formatMeta(meta: Record<string, unknown> | undefined): string {
  if (!meta || !Object.keys(meta).length) return '';
  return ` (${Object.entries(meta).map(([k, v]) => `${k}=${v}`).join(', ')})`;
}

export function formatEvent(event: MonitorEvent): string {
  switch (event.type) {
    case 'job_start': return `▶ ${event.task}`;
    case 'job_done': return `${event.exitCode === 0 ? '✓' : '✗'} job done (exit ${event.exitCode})`;
    case 'step_start': return `↻ ${event.step}${formatMeta(event.meta)}`;
    case 'step_done': return `✓ ${event.step}${formatMeta(event.meta)}`;
    case 'step_failed': return `✗ ${event.step}${event.reason ? ` — ${event.reason}` : ''}`;
    case 'log': return event.stream === 'stderr' ? `[stderr] ${event.line}` : event.line;
    case 'cost': return `$${event.amount.toFixed(4)}${formatMeta(event.meta)}`;
  }
}

export function formatJob(job: JobState): string {
  const ICONS: Record<string, string> = { done: '✓', failed: '✗', running: '↻' };
  const steps = job.steps.length
    ? job.steps.map((s) => `  ${ICONS[s.status] ?? '?'} ${s.name}${s.reason ? ` — ${s.reason}` : ''}`).join('\n')
    : '  (no steps yet)';
  return [
    `[${job.jobId}] ${job.task}`,
    `status: ${job.status}  cost: $${job.totalCost.toFixed(4)}`,
    '',
    steps,
  ].join('\n');
}
