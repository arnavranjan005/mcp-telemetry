import net from 'net';

const CONNECT_TIMEOUT_MS = 300;
const RETRY_DELAY_MS = 250;
const MAX_QUEUE = 1000;

// One persistent socket per socketPath, shared by every JobHandle created
// from the same MCPTelemetry instance — replaces the old connect-per-event
// emitter. Writes are queued and flushed in order over a single connection;
// if the collector isn't reachable yet (or drops), lines stay queued and are
// flushed on the next successful connect, up to MAX_QUEUE entries (oldest
// dropped beyond that — this is still best-effort telemetry, never a
// blocking or throwing guarantee for the caller).
export class QueuedConnection {
  private socket: net.Socket | null = null;
  private connecting = false;
  private closed = false;
  private nextAttemptAt = 0;
  private readonly queue: string[] = [];
  // socket.write() returns before the OS confirms the bytes were actually
  // flushed — queue.length hits 0 the instant write() is *called*, not when
  // its own completion callback fires. drain() needs the latter: otherwise
  // it resolves via a microtask that always runs before that callback's
  // I/O-completion macrotask gets a turn, so the terminal event (job_done)
  // can still be lost if the host process exits right after done() resolves.
  private pendingWrites = 0;

  constructor(private readonly socketPath: string) {}

  send(line: string): void {
    if (this.closed) return;
    this.queue.push(line);
    if (this.queue.length > MAX_QUEUE) this.queue.shift();
    this.flush();
  }

  private flush(): void {
    if (this.closed || !this.queue.length) return;

    if (this.socket && this.socket.writable) {
      const socket = this.socket;
      const batch = this.queue.splice(0, this.queue.length);
      for (const item of batch) {
        this.pendingWrites++;
        socket.write(item, () => { this.pendingWrites--; });
      }
      return;
    }

    if (this.connecting || Date.now() < this.nextAttemptAt) return;
    this.connect();
  }

  private connect(): void {
    this.connecting = true;
    const socket = net.createConnection({ path: this.socketPath });
    socket.unref(); // never keep the host process alive just for this

    const timer = setTimeout(() => socket.destroy(), CONNECT_TIMEOUT_MS);

    socket.on('connect', () => {
      clearTimeout(timer);
      this.connecting = false;
      this.socket = socket;
      this.flush();
    });

    socket.on('error', () => {
      clearTimeout(timer);
      this.connecting = false;
      this.nextAttemptAt = Date.now() + RETRY_DELAY_MS;
      if (this.socket === socket) this.socket = null;
    });

    socket.on('close', () => {
      this.connecting = false;
      if (this.socket === socket) this.socket = null;
    });
  }

  close(): void {
    this.closed = true;
    this.queue.length = 0;
    this.socket?.end();
    this.socket = null;
  }

  // Actively retry delivery of whatever is currently queued instead of
  // passively waiting for another send() to trigger the next attempt — for
  // the last event in a job's lifecycle (job_done), nothing else may ever
  // call send() again, so the normal retry-on-next-send behavior would mean
  // that event silently never gets a second chance if the host process exits
  // right after. Unlike connect()'s socket, this deliberately uses a
  // ref'd setTimeout so it keeps the process alive for up to maxWaitMs —
  // a bounded delay to give the last event a real chance, not indefinite.
  drain(maxWaitMs = 1500): Promise<void> {
    const settled = () => !this.queue.length && this.pendingWrites === 0;
    if (this.closed || settled()) return Promise.resolve();

    return new Promise((resolve) => {
      const deadline = Date.now() + maxWaitMs;
      const attempt = () => {
        if (this.closed || settled()) { resolve(); return; }
        if (this.socket && this.socket.writable) {
          this.flush();
          if (settled()) { resolve(); return; }
          // Write(s) issued but not yet OS-confirmed — poll pendingWrites
          // rather than resolving on queue-empty alone (see field comment).
          if (Date.now() >= deadline) { resolve(); return; }
          setTimeout(attempt, 20);
          return;
        }
        if (Date.now() >= deadline) { resolve(); return; }
        if (!this.connecting) this.connect();
        setTimeout(attempt, RETRY_DELAY_MS);
      };
      attempt();
    });
  }
}
