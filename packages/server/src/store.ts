import type { MonitorEvent, TaskStatus } from '@mcp-telemetry/sdk';

export interface StepState {
  name: string;
  status: 'running' | 'done' | 'failed';
  startedAt: string;
  endedAt?: string;
  meta?: Record<string, unknown>;
  reason?: string;
}

export interface JobState {
  jobId: string;
  task: string;
  status: TaskStatus;
  steps: StepState[];
  logs: string[];
  totalCost: number;
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
}

const JOB_TTL_MS = 5 * 60 * 1000;

export class JobStore {
  private readonly jobs = new Map<string, JobState>();

  apply(event: MonitorEvent): void {
    switch (event.type) {
      case 'job_start':
        this.jobs.set(event.jobId, {
          jobId: event.jobId,
          task: event.task,
          status: 'working',
          steps: [],
          logs: [],
          totalCost: 0,
          startedAt: event.timestamp,
        });
        break;

      case 'job_done': {
        const job = this.jobs.get(event.jobId);
        if (job) {
          job.status = event.exitCode === 0 ? 'completed' : 'failed';
          job.exitCode = event.exitCode;
          job.endedAt = event.timestamp;
        }
        break;
      }

      case 'step_start': {
        const job = this.jobs.get(event.jobId);
        job?.steps.push({ name: event.step, status: 'running', startedAt: event.timestamp, meta: event.meta });
        break;
      }

      case 'step_done': {
        const job = this.jobs.get(event.jobId);
        if (job) {
          const step = [...job.steps].reverse().find(s => s.name === event.step && s.status === 'running');
          if (step) { step.status = 'done'; step.endedAt = event.timestamp; }
        }
        break;
      }

      case 'step_failed': {
        const job = this.jobs.get(event.jobId);
        if (job) {
          const step = [...job.steps].reverse().find(s => s.name === event.step && s.status === 'running');
          if (step) { step.status = 'failed'; step.endedAt = event.timestamp; step.reason = event.reason; }
          if (event.reason === 'input_required') job.status = 'input_required';
        }
        break;
      }

      case 'log': {
        const job = this.jobs.get(event.jobId);
        job?.logs.push(event.stream === 'stderr' ? `[stderr] ${event.line}` : event.line);
        break;
      }

      case 'cost': {
        const job = this.jobs.get(event.jobId);
        if (job) job.totalCost += event.amount;
        break;
      }
    }
  }

  getJob(jobId: string): JobState | undefined {
    return this.jobs.get(jobId);
  }

  getJobs(): JobState[] {
    return [...this.jobs.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  prune(): void {
    const cutoff = Date.now() - JOB_TTL_MS;
    for (const [id, job] of this.jobs) {
      if (job.endedAt && new Date(job.endedAt).getTime() < cutoff) {
        this.jobs.delete(id);
      }
    }
  }
}
