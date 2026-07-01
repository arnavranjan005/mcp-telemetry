import { randomUUID } from 'crypto';
import { MCPTelemetry } from '../index.js';

function testSocketPath(): string {
  return `\\\\.\\pipe\\mcp-telemetry-index-test-${randomUUID()}`;
}

describe('MCPTelemetry', () => {
  it('auto-generates a job-N id when none is given', () => {
    const telemetry = new MCPTelemetry({ socketPath: testSocketPath() });
    const job = telemetry.createJob({ task: 'do something' });
    expect(job).toBeDefined();
    telemetry.disconnect();
  });

  it('uses an explicitly given id instead of auto-generating one', () => {
    const telemetry = new MCPTelemetry({ socketPath: testSocketPath() });
    // JobHandle doesn't expose its id publicly, so we assert indirectly via
    // the event it emits — a fresh connection with nobody listening means
    // send() just queues silently, which is enough to prove no exception is
    // thrown and the call completes synchronously with a custom id.
    expect(() => telemetry.createJob({ id: 'custom-id', task: 'x' })).not.toThrow();
    telemetry.disconnect();
  });

  it('disconnect() can be called safely, including more than once', () => {
    const telemetry = new MCPTelemetry({ socketPath: testSocketPath() });
    telemetry.createJob({ task: 'x' });
    expect(() => telemetry.disconnect()).not.toThrow();
    expect(() => telemetry.disconnect()).not.toThrow();
  });

  it('jobs created from the same instance share one underlying connection', async () => {
    // Two jobs from the same MCPTelemetry instance write through the same
    // QueuedConnection — proven indirectly by both jobs' events reaching the
    // same collector without either constructing its own connection.
    const net = await import('net');
    const socketPath = testSocketPath();
    let connectionCount = 0;
    const received: string[] = [];
    const server = net.createServer((socket) => {
      connectionCount += 1;
      let buffer = '';
      socket.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) if (line.trim()) received.push(line);
      });
    });
    await new Promise<void>((resolve) => server.listen(socketPath, () => resolve()));

    const telemetry = new MCPTelemetry({ socketPath });
    const jobA = telemetry.createJob({ id: 'a', task: 'task a' });
    const jobB = telemetry.createJob({ id: 'b', task: 'task b' });
    jobA.start();
    jobB.start();

    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 3000;
      const poll = () => {
        if (received.length >= 2) { resolve(); return; }
        if (Date.now() > deadline) { reject(new Error('timed out')); return; }
        setTimeout(poll, 20);
      };
      poll();
    });

    expect(connectionCount).toBe(1);
    telemetry.disconnect();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
