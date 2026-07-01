import { JobHandle } from '../job.js';
import type { QueuedConnection } from '../connection.js';
import type { MonitorEvent } from '../protocol.js';

function fakeConnection() {
  const sent: MonitorEvent[] = [];
  const drain = jest.fn().mockResolvedValue(undefined);
  const connection = {
    send: (line: string) => sent.push(JSON.parse(line)),
    drain,
  } as unknown as QueuedConnection;
  return { connection, sent, drain };
}

describe('JobHandle', () => {
  it('start() sends a job_start event with jobId, task, and a timestamp', () => {
    const { connection, sent } = fakeConnection();
    const job = new JobHandle('job-1', 'do the thing', connection);
    job.start();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'job_start', jobId: 'job-1', task: 'do the thing' });
    expect(typeof (sent[0] as { timestamp: string }).timestamp).toBe('string');
  });

  it('done() sends job_done with the given exit code and defaults to 0', async () => {
    const { connection, sent } = fakeConnection();
    const job = new JobHandle('job-1', 'task', connection);

    await job.done();
    expect(sent[0]).toMatchObject({ type: 'job_done', jobId: 'job-1', exitCode: 0 });

    await job.done(1);
    expect(sent[1]).toMatchObject({ type: 'job_done', jobId: 'job-1', exitCode: 1 });
  });

  it('done() awaits connection.drain() so the terminal event gets a real delivery attempt', async () => {
    const { connection, drain } = fakeConnection();
    const job = new JobHandle('job-1', 'task', connection);

    await job.done(0);
    expect(drain).toHaveBeenCalledTimes(1);
  });

  it('stepStart()/stepDone() forward the step name and optional meta', () => {
    const { connection, sent } = fakeConnection();
    const job = new JobHandle('job-1', 'task', connection);

    job.stepStart('build', { cycleType: 'feature' });
    job.stepDone('build', { turns: 3 });

    expect(sent[0]).toMatchObject({ type: 'step_start', step: 'build', meta: { cycleType: 'feature' } });
    expect(sent[1]).toMatchObject({ type: 'step_done', step: 'build', meta: { turns: 3 } });
  });

  it('stepFailed() forwards an optional reason', () => {
    const { connection, sent } = fakeConnection();
    const job = new JobHandle('job-1', 'task', connection);

    job.stepFailed('test');
    job.stepFailed('deploy', 'timeout');

    expect(sent[0]).toMatchObject({ type: 'step_failed', step: 'test' });
    expect((sent[0] as { reason?: string }).reason).toBeUndefined();
    expect(sent[1]).toMatchObject({ type: 'step_failed', step: 'deploy', reason: 'timeout' });
  });

  it('log() forwards the line and an optional stream tag', () => {
    const { connection, sent } = fakeConnection();
    const job = new JobHandle('job-1', 'task', connection);

    job.log('plain line');
    job.log('stdout line', 'stdout');
    job.log('error line', 'stderr');

    expect(sent[0]).toMatchObject({ type: 'log', line: 'plain line' });
    expect((sent[0] as { stream?: string }).stream).toBeUndefined();
    expect(sent[1]).toMatchObject({ type: 'log', line: 'stdout line', stream: 'stdout' });
    expect(sent[2]).toMatchObject({ type: 'log', line: 'error line', stream: 'stderr' });
  });

  it('cost() forwards the amount and optional meta', () => {
    const { connection, sent } = fakeConnection();
    const job = new JobHandle('job-1', 'task', connection);

    job.cost(0.42, { model: 'claude-sonnet-5' });

    expect(sent[0]).toMatchObject({ type: 'cost', amount: 0.42, meta: { model: 'claude-sonnet-5' } });
  });

  it('tags every event with the jobId it was constructed with', () => {
    const { connection, sent } = fakeConnection();
    const job = new JobHandle('job-42', 'task', connection);

    job.start();
    job.stepStart('a');
    job.log('x');
    job.cost(1);

    for (const event of sent) expect(event.jobId).toBe('job-42');
  });
});
