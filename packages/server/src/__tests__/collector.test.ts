import net from 'net';
import { randomUUID } from 'crypto';
import { Collector } from '../collector.js';
import type { MonitorEvent } from '@mcp-telemetry/sdk';

function testSocketPath(): string {
  return `\\\\.\\pipe\\collector-test-${randomUUID()}`;
}

function connectAndWrite(socketPath: string, raw: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ path: socketPath }, () => {
      socket.write(raw, () => { socket.end(); resolve(); });
    });
    socket.on('error', reject);
  });
}

function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (check()) { resolve(); return; }
      if (Date.now() > deadline) { reject(new Error('waitFor: timed out')); return; }
      setTimeout(poll, 20);
    };
    poll();
  });
}

describe('Collector', () => {
  it('parses a single NDJSON line and delivers it to registered handlers', async () => {
    const socketPath = testSocketPath();
    const collector = new Collector(socketPath);
    await collector.listen();

    const events: MonitorEvent[] = [];
    collector.onEvent((e) => events.push(e));

    await connectAndWrite(socketPath, JSON.stringify({ type: 'job_start', jobId: 'j1', task: 't', timestamp: 'x' }) + '\n');

    await waitFor(() => events.length >= 1);
    expect(events[0]).toMatchObject({ type: 'job_start', jobId: 'j1' });

    collector.close();
  });

  it('parses multiple NDJSON lines delivered in a single write', async () => {
    const socketPath = testSocketPath();
    const collector = new Collector(socketPath);
    await collector.listen();

    const events: MonitorEvent[] = [];
    collector.onEvent((e) => events.push(e));

    const lines = [
      { type: 'job_start', jobId: 'j1', task: 't', timestamp: 'x' },
      { type: 'step_start', jobId: 'j1', step: 'build', timestamp: 'x' },
      { type: 'job_done', jobId: 'j1', exitCode: 0, timestamp: 'x' },
    ].map((e) => JSON.stringify(e)).join('\n') + '\n';

    await connectAndWrite(socketPath, lines);

    await waitFor(() => events.length >= 3);
    expect(events.map((e) => e.type)).toEqual(['job_start', 'step_start', 'job_done']);

    collector.close();
  });

  it('reassembles a line split across multiple writes', async () => {
    const socketPath = testSocketPath();
    const collector = new Collector(socketPath);
    await collector.listen();

    const events: MonitorEvent[] = [];
    collector.onEvent((e) => events.push(e));

    const full = JSON.stringify({ type: 'log', jobId: 'j1', line: 'hello world', timestamp: 'x' }) + '\n';
    const splitPoint = Math.floor(full.length / 2);

    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ path: socketPath }, () => {
        socket.write(full.slice(0, splitPoint), () => {
          setTimeout(() => {
            socket.write(full.slice(splitPoint), () => { socket.end(); resolve(); });
          }, 50);
        });
      });
      socket.on('error', reject);
    });

    await waitFor(() => events.length >= 1);
    expect(events[0]).toMatchObject({ type: 'log', line: 'hello world' });

    collector.close();
  });

  it('silently ignores malformed JSON without dropping subsequent valid lines', async () => {
    const socketPath = testSocketPath();
    const collector = new Collector(socketPath);
    await collector.listen();

    const events: MonitorEvent[] = [];
    collector.onEvent((e) => events.push(e));

    const payload = 'not valid json\n' + JSON.stringify({ type: 'job_start', jobId: 'j1', task: 't', timestamp: 'x' }) + '\n';
    await connectAndWrite(socketPath, payload);

    await waitFor(() => events.length >= 1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'job_start', jobId: 'j1' });

    collector.close();
  });

  it('offEvent stops a handler from receiving further events', async () => {
    const socketPath = testSocketPath();
    const collector = new Collector(socketPath);
    await collector.listen();

    const events: MonitorEvent[] = [];
    const handler = (e: MonitorEvent) => events.push(e);
    collector.onEvent(handler);

    await connectAndWrite(socketPath, JSON.stringify({ type: 'job_start', jobId: 'j1', task: 't', timestamp: 'x' }) + '\n');
    await waitFor(() => events.length >= 1);

    collector.offEvent(handler);
    await connectAndWrite(socketPath, JSON.stringify({ type: 'job_start', jobId: 'j2', task: 't', timestamp: 'x' }) + '\n');
    await new Promise((r) => setTimeout(r, 200)); // give it a chance to (wrongly) arrive

    expect(events).toHaveLength(1);
    collector.close();
  });

  it('handles multiple concurrent producer connections independently', async () => {
    const socketPath = testSocketPath();
    const collector = new Collector(socketPath);
    await collector.listen();

    const events: MonitorEvent[] = [];
    collector.onEvent((e) => events.push(e));

    await Promise.all([
      connectAndWrite(socketPath, JSON.stringify({ type: 'job_start', jobId: 'a', task: 't', timestamp: 'x' }) + '\n'),
      connectAndWrite(socketPath, JSON.stringify({ type: 'job_start', jobId: 'b', task: 't', timestamp: 'x' }) + '\n'),
    ]);

    await waitFor(() => events.length >= 2);
    expect(events.map((e) => (e as { jobId: string }).jobId).sort()).toEqual(['a', 'b']);

    collector.close();
  });
});
