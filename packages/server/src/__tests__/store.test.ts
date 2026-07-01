import { JobStore } from '../store.js';
import type { MonitorEvent } from 'mcp-telemetry-sdk';

// Distributive omit — Omit<MonitorEvent, 'timestamp'> directly would collapse
// to only the keys common across every union member (just `type`/`jobId`),
// since `keyof` on a union is an intersection. The `T extends any ? ... : never`
// form distributes over the union first, so each branch keeps its own fields.
type WithoutTimestamp<T> = T extends MonitorEvent ? Omit<T, 'timestamp'> : never;

function ev(event: WithoutTimestamp<MonitorEvent> & { timestamp?: string }): MonitorEvent {
  return { timestamp: new Date().toISOString(), ...event } as MonitorEvent;
}

describe('JobStore', () => {
  it('job_start creates a job with working status and empty state', () => {
    const store = new JobStore();
    store.apply(ev({ type: 'job_start', jobId: 'j1', task: 'do the thing' }));

    const job = store.getJob('j1');
    expect(job).toMatchObject({
      jobId: 'j1',
      task: 'do the thing',
      status: 'working',
      steps: [],
      logs: [],
      totalCost: 0,
    });
  });

  it('job_done marks status completed on exit code 0, failed otherwise', () => {
    const store = new JobStore();
    store.apply(ev({ type: 'job_start', jobId: 'ok', task: 't' }));
    store.apply(ev({ type: 'job_start', jobId: 'bad', task: 't' }));

    store.apply(ev({ type: 'job_done', jobId: 'ok', exitCode: 0 }));
    store.apply(ev({ type: 'job_done', jobId: 'bad', exitCode: 1 }));

    expect(store.getJob('ok')).toMatchObject({ status: 'completed', exitCode: 0 });
    expect(store.getJob('bad')).toMatchObject({ status: 'failed', exitCode: 1 });
    expect(store.getJob('ok')!.endedAt).toBeDefined();
  });

  it('step_start/step_done transitions a step from running to done, meta preserved', () => {
    const store = new JobStore();
    store.apply(ev({ type: 'job_start', jobId: 'j1', task: 't' }));
    store.apply(ev({ type: 'step_start', jobId: 'j1', step: 'build', meta: { cycleType: 'feature' } }));

    let job = store.getJob('j1')!;
    expect(job.steps).toHaveLength(1);
    expect(job.steps[0]).toMatchObject({ name: 'build', status: 'running', meta: { cycleType: 'feature' } });

    store.apply(ev({ type: 'step_done', jobId: 'j1', step: 'build', meta: { turns: 3 } }));
    job = store.getJob('j1')!;
    expect(job.steps[0]).toMatchObject({ name: 'build', status: 'done' });
    expect(job.steps[0].endedAt).toBeDefined();
  });

  it('step_failed marks the step failed with a reason, and sets input_required specially', () => {
    const store = new JobStore();
    store.apply(ev({ type: 'job_start', jobId: 'j1', task: 't' }));
    store.apply(ev({ type: 'step_start', jobId: 'j1', step: 'deploy' }));
    store.apply(ev({ type: 'step_failed', jobId: 'j1', step: 'deploy', reason: 'timeout' }));

    let job = store.getJob('j1')!;
    expect(job.steps[0]).toMatchObject({ status: 'failed', reason: 'timeout' });
    expect(job.status).toBe('working');

    store.apply(ev({ type: 'step_start', jobId: 'j1', step: 'ask' }));
    store.apply(ev({ type: 'step_failed', jobId: 'j1', step: 'ask', reason: 'input_required' }));
    job = store.getJob('j1')!;
    expect(job.status).toBe('input_required');
  });

  it('updates the most recently started running step when names repeat', () => {
    const store = new JobStore();
    store.apply(ev({ type: 'job_start', jobId: 'j1', task: 't' }));
    store.apply(ev({ type: 'step_start', jobId: 'j1', step: 'build' }));
    store.apply(ev({ type: 'step_done', jobId: 'j1', step: 'build' }));
    store.apply(ev({ type: 'step_start', jobId: 'j1', step: 'build' })); // same name, second run
    store.apply(ev({ type: 'step_done', jobId: 'j1', step: 'build' }));

    const job = store.getJob('j1')!;
    expect(job.steps).toHaveLength(2);
    expect(job.steps[0].status).toBe('done');
    expect(job.steps[1].status).toBe('done');
  });

  it('log appends stdout lines as-is and prefixes stderr lines', () => {
    const store = new JobStore();
    store.apply(ev({ type: 'job_start', jobId: 'j1', task: 't' }));
    store.apply(ev({ type: 'log', jobId: 'j1', line: 'building...', stream: 'stdout' }));
    store.apply(ev({ type: 'log', jobId: 'j1', line: 'boom', stream: 'stderr' }));
    store.apply(ev({ type: 'log', jobId: 'j1', line: 'no stream tag' }));

    const job = store.getJob('j1')!;
    expect(job.logs).toEqual(['building...', '[stderr] boom', 'no stream tag']);
  });

  it('cost accumulates across multiple events', () => {
    const store = new JobStore();
    store.apply(ev({ type: 'job_start', jobId: 'j1', task: 't' }));
    store.apply(ev({ type: 'cost', jobId: 'j1', amount: 0.1 }));
    store.apply(ev({ type: 'cost', jobId: 'j1', amount: 0.25 }));

    expect(store.getJob('j1')!.totalCost).toBeCloseTo(0.35);
  });

  it('events for a job that never started are safely ignored', () => {
    const store = new JobStore();
    expect(() => {
      store.apply(ev({ type: 'step_start', jobId: 'ghost', step: 'x' }));
      store.apply(ev({ type: 'log', jobId: 'ghost', line: 'x' }));
      store.apply(ev({ type: 'cost', jobId: 'ghost', amount: 1 }));
      store.apply(ev({ type: 'job_done', jobId: 'ghost', exitCode: 0 }));
    }).not.toThrow();
    expect(store.getJob('ghost')).toBeUndefined();
  });

  it('getJobs returns all jobs sorted by startedAt ascending', () => {
    const store = new JobStore();
    store.apply(ev({ type: 'job_start', jobId: 'later', task: 't', timestamp: '2026-01-01T00:00:02.000Z' }));
    store.apply(ev({ type: 'job_start', jobId: 'earlier', task: 't', timestamp: '2026-01-01T00:00:01.000Z' }));

    const jobs = store.getJobs();
    expect(jobs.map((j) => j.jobId)).toEqual(['earlier', 'later']);
  });

  it('prune removes only ended jobs older than the TTL', () => {
    const store = new JobStore();
    const old = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago, past the 5 min TTL
    const recent = new Date().toISOString();

    store.apply(ev({ type: 'job_start', jobId: 'old-done', task: 't' }));
    store.apply(ev({ type: 'job_done', jobId: 'old-done', exitCode: 0, timestamp: old }));

    store.apply(ev({ type: 'job_start', jobId: 'recent-done', task: 't' }));
    store.apply(ev({ type: 'job_done', jobId: 'recent-done', exitCode: 0, timestamp: recent }));

    store.apply(ev({ type: 'job_start', jobId: 'still-running', task: 't' }));

    store.prune();

    expect(store.getJob('old-done')).toBeUndefined();
    expect(store.getJob('recent-done')).toBeDefined();
    expect(store.getJob('still-running')).toBeDefined();
  });
});
