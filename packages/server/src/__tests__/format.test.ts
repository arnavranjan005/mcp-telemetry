import { formatEvent, formatMeta, formatJob } from '../format.js';
import type { MonitorEvent } from 'mcp-telemetry-sdk';
import type { JobState } from '../store.js';

const ts = new Date().toISOString();

describe('formatMeta', () => {
  it('returns empty string for undefined or empty meta', () => {
    expect(formatMeta(undefined)).toBe('');
    expect(formatMeta({})).toBe('');
  });

  it('formats key=value pairs, comma separated, in parens', () => {
    expect(formatMeta({ cycleType: 'feature' })).toBe(' (cycleType=feature)');
    expect(formatMeta({ turns: 3, cost: 0.4 })).toBe(' (turns=3, cost=0.4)');
  });
});

describe('formatEvent', () => {
  it('job_start', () => {
    const e: MonitorEvent = { type: 'job_start', jobId: 'j', task: 'deploy', timestamp: ts };
    expect(formatEvent(e)).toBe('▶ deploy');
  });

  it('job_done shows a check on success and an X on failure', () => {
    expect(formatEvent({ type: 'job_done', jobId: 'j', exitCode: 0, timestamp: ts })).toBe('✓ job done (exit 0)');
    expect(formatEvent({ type: 'job_done', jobId: 'j', exitCode: 1, timestamp: ts })).toBe('✗ job done (exit 1)');
  });

  it('step_start/step_done include meta when present', () => {
    expect(formatEvent({ type: 'step_start', jobId: 'j', step: 'build', timestamp: ts })).toBe('↻ build');
    expect(formatEvent({ type: 'step_start', jobId: 'j', step: 'build', meta: { cycleType: 'feature' }, timestamp: ts }))
      .toBe('↻ build (cycleType=feature)');
    expect(formatEvent({ type: 'step_done', jobId: 'j', step: 'build', meta: { turns: 4 }, timestamp: ts }))
      .toBe('✓ build (turns=4)');
  });

  it('step_failed includes the reason only when present', () => {
    expect(formatEvent({ type: 'step_failed', jobId: 'j', step: 'deploy', timestamp: ts })).toBe('✗ deploy');
    expect(formatEvent({ type: 'step_failed', jobId: 'j', step: 'deploy', reason: 'timeout', timestamp: ts }))
      .toBe('✗ deploy — timeout');
  });

  it('log passes stdout through as-is and prefixes stderr', () => {
    expect(formatEvent({ type: 'log', jobId: 'j', line: 'hello', timestamp: ts })).toBe('hello');
    expect(formatEvent({ type: 'log', jobId: 'j', line: 'hello', stream: 'stdout', timestamp: ts })).toBe('hello');
    expect(formatEvent({ type: 'log', jobId: 'j', line: 'oops', stream: 'stderr', timestamp: ts })).toBe('[stderr] oops');
  });

  it('cost formats to 4 decimals and includes meta when present', () => {
    expect(formatEvent({ type: 'cost', jobId: 'j', amount: 0.4, timestamp: ts })).toBe('$0.4000');
    expect(formatEvent({ type: 'cost', jobId: 'j', amount: 0.42, meta: { model: 'sonnet' }, timestamp: ts }))
      .toBe('$0.4200 (model=sonnet)');
  });
});

describe('formatJob', () => {
  function job(overrides: Partial<JobState> = {}): JobState {
    return {
      jobId: 'j1', task: 'deploy', status: 'working', steps: [], logs: [], totalCost: 0,
      startedAt: ts, ...overrides,
    };
  }

  it('shows "(no steps yet)" when there are no steps', () => {
    const text = formatJob(job());
    expect(text).toContain('[j1] deploy');
    expect(text).toContain('status: working  cost: $0.0000');
    expect(text).toContain('(no steps yet)');
  });

  it('lists steps with the right icon per status', () => {
    const text = formatJob(job({
      steps: [
        { name: 'build', status: 'done', startedAt: ts },
        { name: 'test', status: 'failed', startedAt: ts, reason: 'assertion failed' },
        { name: 'deploy', status: 'running', startedAt: ts },
      ],
    }));
    expect(text).toContain('✓ build');
    expect(text).toContain('✗ test — assertion failed');
    expect(text).toContain('↻ deploy');
  });

  it('formats total cost to 4 decimals', () => {
    const text = formatJob(job({ totalCost: 1.5 }));
    expect(text).toContain('cost: $1.5000');
  });
});
