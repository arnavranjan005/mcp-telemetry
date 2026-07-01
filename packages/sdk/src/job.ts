import type { QueuedConnection } from './connection.js';
import type { MonitorEvent } from './protocol.js';

function now(): string { return new Date().toISOString(); }

export class JobHandle {
  constructor(
    private readonly jobId: string,
    private readonly task: string,
    private readonly connection: QueuedConnection,
  ) {}

  private send(event: MonitorEvent): void {
    this.connection.send(JSON.stringify(event) + '\n');
  }

  start(): void {
    this.send({ type: 'job_start', jobId: this.jobId, task: this.task, timestamp: now() });
  }

  // Async because this is the terminal event — nothing else may ever call
  // send() again on this job, so it actively drains instead of relying on a
  // future send() to retry delivery (see QueuedConnection.drain). Safe to
  // call without awaiting; the drain still runs in the background either way.
  async done(exitCode = 0): Promise<void> {
    this.send({ type: 'job_done', jobId: this.jobId, exitCode, timestamp: now() });
    await this.connection.drain();
  }

  stepStart(step: string, meta?: Record<string, unknown>): void {
    this.send({ type: 'step_start', jobId: this.jobId, step, meta, timestamp: now() });
  }

  stepDone(step: string, meta?: Record<string, unknown>): void {
    this.send({ type: 'step_done', jobId: this.jobId, step, meta, timestamp: now() });
  }

  stepFailed(step: string, reason?: string): void {
    this.send({ type: 'step_failed', jobId: this.jobId, step, reason, timestamp: now() });
  }

  log(line: string, stream?: 'stdout' | 'stderr'): void {
    this.send({ type: 'log', jobId: this.jobId, line, stream, timestamp: now() });
  }

  cost(amount: number, meta?: Record<string, unknown>): void {
    this.send({ type: 'cost', jobId: this.jobId, amount, meta, timestamp: now() });
  }
}
