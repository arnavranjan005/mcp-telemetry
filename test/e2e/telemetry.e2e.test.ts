import { MCPTelemetry, getSocketPath } from 'mcp-telemetry-sdk';
import { startMcpTelemetryServer, initializeMcp, progressNotifications, McpTestClient } from './helpers.js';

describe('mcp-telemetry end-to-end (real compiled server + real sdk producer)', () => {
  let client: McpTestClient;
  let telemetry: MCPTelemetry;

  beforeEach(async () => {
    client = startMcpTelemetryServer();
    await initializeMcp(client);
    telemetry = new MCPTelemetry({ socketPath: getSocketPath(client.cwd) });
  });

  afterEach(() => {
    telemetry.disconnect();
    client.close();
  });

  it('telemetry_jobs reports no jobs before anything runs', async () => {
    const result = await client.request('tools/call', { name: 'telemetry_jobs', arguments: {} });
    const text = (result as { content: Array<{ text: string }> }).content[0].text;
    expect(text).toBe('No jobs yet.');
  });

  it('telemetry_subscribe streams structured progress and resolves on job_done', async () => {
    const subscribePromise = client.request(
      'tools/call',
      { name: 'telemetry_subscribe', arguments: { jobId: 'e2e-1', timeoutMs: 5000 } },
      { progressToken: 'tok-1' },
    );

    // Give the tool call time to register its handler before firing events.
    await new Promise((r) => setTimeout(r, 200));

    const job = telemetry.createJob({ id: 'e2e-1', task: 'e2e test job' });
    job.start();
    job.stepStart('build', { cycleType: 'feature' });
    job.stepDone('build', { turns: 2 });
    job.cost(0.5, { model: 'claude-sonnet-5' });
    await job.done(0);

    const result = await subscribePromise;
    const text = (result as { content: Array<{ text: string }> }).content[0].text;
    expect(text).toBe('Job e2e-1 finished (exit 0).');

    const messages = progressNotifications(client).map((p) => p.message);
    expect(messages).toEqual([
      '▶ e2e test job',
      '↻ build (cycleType=feature)',
      '✓ build (turns=2)',
      '$0.5000 (model=claude-sonnet-5)',
      '✓ job done (exit 0)',
    ]);
  });

  it('telemetry_subscribe ignores events for other job ids', async () => {
    const subscribePromise = client.request(
      'tools/call',
      { name: 'telemetry_subscribe', arguments: { jobId: 'target', timeoutMs: 5000 } },
      { progressToken: 'tok-2' },
    );
    await new Promise((r) => setTimeout(r, 200));

    const other = telemetry.createJob({ id: 'other', task: 'noise' });
    other.start();
    await other.done(0);

    const target = telemetry.createJob({ id: 'target', task: 'the one we want' });
    target.start();
    await target.done(0);

    const result = await subscribePromise;
    const text = (result as { content: Array<{ text: string }> }).content[0].text;
    expect(text).toBe('Job target finished (exit 0).');

    const messages = progressNotifications(client).map((p) => p.message);
    expect(messages).toEqual(['▶ the one we want', '✓ job done (exit 0)']);
  });

  it('telemetry_subscribe coalesces rapid log lines into batched pushes instead of one per line', async () => {
    const subscribePromise = client.request(
      'tools/call',
      { name: 'telemetry_subscribe', arguments: { jobId: 'chatty', timeoutMs: 5000 } },
      { progressToken: 'tok-3' },
    );
    await new Promise((r) => setTimeout(r, 200));

    const job = telemetry.createJob({ id: 'chatty', task: 'chatty job' });
    job.start();
    for (let i = 0; i < 10; i++) job.log(`line ${i}`, 'stdout');
    await job.done(0);

    await subscribePromise;

    const messages = progressNotifications(client).map((p) => p.message);
    // job_start + job_done are always their own pushes; the 10 log lines
    // should have been coalesced into far fewer than 10 separate messages.
    expect(messages.length).toBeLessThan(12);
    expect(messages.some((m) => m.split('\n').length > 1)).toBe(true);
  });

  it('telemetry_subscribe times out and resolves (not hangs) if the job never finishes', async () => {
    const start = Date.now();
    const result = await client.request(
      'tools/call',
      { name: 'telemetry_subscribe', arguments: { jobId: 'never-started', timeoutMs: 500 } },
    );
    const elapsed = Date.now() - start;

    const text = (result as { content: Array<{ text: string }> }).content[0].text;
    expect(text).toBe('Timed out waiting for job completion.');
    expect(elapsed).toBeGreaterThanOrEqual(450);
    expect(elapsed).toBeLessThan(3000);
  });

  it('telemetry_jobs and telemetry_job_status reflect a completed job', async () => {
    const job = telemetry.createJob({ id: 'status-check', task: 'check my status' });
    job.start();
    job.stepStart('build');
    job.stepDone('build');
    await job.done(0);

    // No subscriber this time — give the collector a moment to process the
    // fire-and-forget writes before polling telemetry_jobs.
    await new Promise((r) => setTimeout(r, 300));

    const jobsResult = await client.request('tools/call', { name: 'telemetry_jobs', arguments: {} });
    const jobsText = (jobsResult as { content: Array<{ text: string }> }).content[0].text;
    expect(jobsText).toContain('[status-check] check my status');
    expect(jobsText).toMatch(/^✓/);

    const statusResult = await client.request('tools/call', { name: 'telemetry_job_status', arguments: { jobId: 'status-check' } });
    const statusText = (statusResult as { content: Array<{ text: string }> }).content[0].text;
    expect(statusText).toContain('status: completed');
    expect(statusText).toContain('✓ build');
  });

  it('telemetry_job_status reports an error for an unknown job id', async () => {
    const result = await client.request('tools/call', { name: 'telemetry_job_status', arguments: { jobId: 'no-such-job' } }) as {
      content: Array<{ text: string }>; isError?: boolean;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('No job found');
  });

  it('the drain fix: job.done() called with the collector not yet listening still delivers job_done', async () => {
    // Deliberately don't touch the beforeEach-provided client/server for this
    // test — reusing a socket path right after killing whatever was bound to
    // it would depend on the OS releasing that named pipe promptly, which
    // isn't guaranteed and would make this test flaky for a reason unrelated
    // to what it's actually verifying. Use a brand new, never-before-bound
    // directory instead, so there's no prior listener to race against.
    const { mkdtempSync } = await import('fs');
    const { tmpdir } = await import('os');
    const path = await import('path');
    const cwd = mkdtempSync(path.join(tmpdir(), 'mcp-telemetry-drain-e2e-'));

    const producer = new MCPTelemetry({ socketPath: getSocketPath(cwd) });
    const job = producer.createJob({ id: 'drain-e2e', task: 'drain gap e2e' });
    job.start();
    const donePromise = job.done(0); // nothing listening yet — this actively drains

    await new Promise((r) => setTimeout(r, 400));

    // Bring a server up on that same (freshly minted) cwd within the drain window.
    const { spawn } = await import('child_process');
    const serverBin = path.resolve(__dirname, '../../packages/server/bin/server.js');
    const proc = spawn(process.execPath, [serverBin], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });

    let buf = '';
    const notifications: Array<{ id?: number; result?: unknown }> = [];
    const pending = new Map<number, (v: unknown) => void>();
    proc.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        notifications.push(msg);
        if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)!(msg.result); pending.delete(msg.id); }
      }
    });
    function req(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
      const id = Math.floor(Math.random() * 1e9);
      return new Promise((resolve) => {
        pending.set(id, resolve);
        proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      });
    }

    await req('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'x', version: '0' } });
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    await new Promise((r) => setTimeout(r, 150));

    await donePromise; // should now resolve, having delivered job_start + job_done

    const statusResult = await req('tools/call', { name: 'telemetry_job_status', arguments: { jobId: 'drain-e2e' } }) as {
      content: Array<{ text: string }>;
    };
    expect(statusResult.content[0].text).toContain('status: completed');

    producer.disconnect();
    proc.kill();
  });
});
