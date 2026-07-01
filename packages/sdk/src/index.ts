import { JobHandle } from './job.js';
import { QueuedConnection } from './connection.js';
import { getSocketPath } from './protocol.js';

export interface CreateJobOptions {
  id?: string;
  task: string;
}

export interface MCPTelemetryOptions {
  socketPath?: string;
}

let counter = 0;

export class MCPTelemetry {
  // One persistent connection per instance, shared by every job it creates —
  // replaces opening a fresh socket for every single event.
  private readonly connection: QueuedConnection;

  constructor(opts: MCPTelemetryOptions = {}) {
    this.connection = new QueuedConnection(opts.socketPath ?? getSocketPath());
  }

  createJob(opts: CreateJobOptions): JobHandle {
    const jobId = opts.id ?? `job-${++counter}`;
    return new JobHandle(jobId, opts.task, this.connection);
  }

  // Call when the host MCP server is done emitting telemetry (e.g. on
  // shutdown, or once a job's lifecycle is fully over) to drop the
  // connection instead of leaving it idle.
  disconnect(): void {
    this.connection.close();
  }
}

export { JobHandle } from './job.js';
export { MonitorEvent, TaskStatus, getSocketPath } from './protocol.js';
