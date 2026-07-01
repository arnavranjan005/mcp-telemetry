import net from 'net';
import { randomUUID } from 'crypto';
import { QueuedConnection } from '../connection.js';

function testSocketPath(): string {
  return `\\\\.\\pipe\\qc-test-${randomUUID()}`;
}

// A minimal stand-in for the real Collector — accepts connections, buffers by
// newline, and records every parsed line plus how many separate connections
// it saw, so tests can assert on both delivery and connection reuse.
function startFakeCollector(socketPath: string) {
  const received: string[] = [];
  let connectionCount = 0;
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
  const listen = () => new Promise<void>((resolve, reject) => {
    server.listen(socketPath, () => resolve());
    server.on('error', reject);
  });
  const close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return { received, connectionCount: () => connectionCount, listen, close };
}

function waitFor(check: () => boolean, timeoutMs = 3000, intervalMs = 20): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (check()) { resolve(); return; }
      if (Date.now() > deadline) { reject(new Error('waitFor: timed out')); return; }
      setTimeout(poll, intervalMs);
    };
    poll();
  });
}

describe('QueuedConnection', () => {
  it('delivers events queued before the collector exists once a later send retries the connection', async () => {
    // Retries are triggered by the next send(), not by a background timer —
    // so recovery here depends on a follow-up send happening after the
    // collector comes up, matching real producer usage (more events keep
    // arriving over a job's lifetime). See the drain() tests below for the
    // one case (job.done()) that doesn't rely on a follow-up send existing.
    const socketPath = testSocketPath();
    const conn = new QueuedConnection(socketPath);

    conn.send('first\n');

    const collector = startFakeCollector(socketPath);
    await collector.listen();
    await new Promise((r) => setTimeout(r, 700)); // clear the failed attempt's backoff window

    conn.send('second\n');

    await waitFor(() => collector.received.length >= 2);
    expect(collector.received).toEqual(['first', 'second']);

    conn.close();
    await collector.close();
  });

  it('reuses a single connection across many sends instead of opening one per event', async () => {
    const socketPath = testSocketPath();
    const collector = startFakeCollector(socketPath);
    await collector.listen();

    const conn = new QueuedConnection(socketPath);
    for (let i = 0; i < 10; i++) conn.send(`line-${i}\n`);

    await waitFor(() => collector.received.length >= 10);
    expect(collector.received).toEqual(Array.from({ length: 10 }, (_, i) => `line-${i}`));
    expect(collector.connectionCount()).toBe(1);

    conn.close();
    await collector.close();
  });

  it('preserves order across a burst queued while the connection is still establishing', async () => {
    // Collector is already up, but the burst below fires synchronously —
    // none of these individual sends can possibly see an already-connected
    // socket, since the very first one is what kicks off connect() in the
    // first place. This is the real-world shape (e.g. a burst of stdout
    // lines arriving right as a job starts).
    const socketPath = testSocketPath();
    const collector = startFakeCollector(socketPath);
    await collector.listen();

    const conn = new QueuedConnection(socketPath);
    for (let i = 0; i < 25; i++) conn.send(`burst-${i}\n`);

    await waitFor(() => collector.received.length >= 25);
    expect(collector.received).toEqual(Array.from({ length: 25 }, (_, i) => `burst-${i}`));
    expect(collector.connectionCount()).toBe(1);

    conn.close();
    await collector.close();
  });

  it('queued events survive a failed connect and deliver once a later send succeeds', async () => {
    const socketPath = testSocketPath();
    const conn = new QueuedConnection(socketPath);

    // No collector listening yet — this send will fail to connect.
    conn.send('early\n');

    // Give the failed attempt time to resolve and clear its backoff window
    // (connect timeout 300ms + retry backoff 250ms in the implementation).
    await new Promise((r) => setTimeout(r, 700));

    const collector = startFakeCollector(socketPath);
    await collector.listen();

    // A later send is what actually triggers the next connect attempt.
    conn.send('later\n');

    await waitFor(() => collector.received.length >= 2);
    expect(collector.received).toEqual(['early', 'later']);

    conn.close();
    await collector.close();
  });

  it('drain() resolves once a queued event is delivered, even if the collector starts late', async () => {
    const socketPath = testSocketPath();
    const conn = new QueuedConnection(socketPath);

    conn.send('needs-drain\n');
    const drainPromise = conn.drain(3000);

    const collector = startFakeCollector(socketPath);
    // Start the collector shortly after drain() begins actively retrying.
    setTimeout(() => { collector.listen(); }, 400);

    await drainPromise;
    expect(collector.received).toContain('needs-drain');

    conn.close();
    await collector.close();
  });

  it('drain() gives up after its timeout when nothing is ever listening', async () => {
    const socketPath = testSocketPath();
    const conn = new QueuedConnection(socketPath);

    conn.send('never-delivered\n');

    const start = Date.now();
    await conn.drain(500);
    const elapsed = Date.now() - start;

    // Resolves without throwing, and respects the bound instead of hanging.
    expect(elapsed).toBeLessThan(2000);
    conn.close();
  });

  it('drain() resolves immediately when the queue is already empty', async () => {
    const conn = new QueuedConnection(testSocketPath());
    const start = Date.now();
    await conn.drain(5000);
    expect(Date.now() - start).toBeLessThan(100);
    conn.close();
  });

  it('close() stops accepting further sends', async () => {
    const socketPath = testSocketPath();
    const collector = startFakeCollector(socketPath);
    await collector.listen();

    const conn = new QueuedConnection(socketPath);
    conn.close();
    conn.send('should-not-arrive\n');

    // Give it a moment — nothing should show up because close() marks the
    // connection closed and clears the queue before send() can add to it.
    await new Promise((r) => setTimeout(r, 300));
    expect(collector.received).toEqual([]);

    await collector.close();
  });
});
