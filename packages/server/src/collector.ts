import net from 'net';
import { existsSync, unlinkSync } from 'fs';
import type { MonitorEvent } from '@mcp-telemetry/sdk';

export class Collector {
  private readonly server: net.Server;
  private readonly handlers: Array<(event: MonitorEvent) => void> = [];

  constructor(private readonly socketPath: string) {
    this.server = net.createServer((socket) => {
      let buffer = '';
      socket.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as MonitorEvent;
            for (const h of this.handlers) h(event);
          } catch { /* ignore malformed NDJSON */ }
        }
      });
    });
  }

  onEvent(handler: (event: MonitorEvent) => void): void {
    this.handlers.push(handler);
  }

  offEvent(handler: (event: MonitorEvent) => void): void {
    const idx = this.handlers.indexOf(handler);
    if (idx !== -1) this.handlers.splice(idx, 1);
  }

  listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (process.platform !== 'win32' && existsSync(this.socketPath)) {
        unlinkSync(this.socketPath);
      }
      this.server.listen(this.socketPath, () => resolve());
      this.server.on('error', reject);
    });
  }

  close(): void {
    this.server.close();
    if (process.platform !== 'win32' && existsSync(this.socketPath)) {
      try { unlinkSync(this.socketPath); } catch { /* best-effort */ }
    }
  }
}
