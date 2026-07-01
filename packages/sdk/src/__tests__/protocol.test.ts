import { getSocketPath } from '../protocol.js';

describe('getSocketPath', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  function setPlatform(platform: string) {
    Object.defineProperty(process, 'platform', { value: platform });
  }

  it('returns a Windows named pipe path on win32', () => {
    setPlatform('win32');
    const path = getSocketPath('C:\\some\\project');
    expect(path).toMatch(/^\\\\\.\\pipe\\mcp-telemetry-[0-9a-f]{8}$/);
  });

  it('is stable for the same root passed identically', () => {
    setPlatform('win32');
    const a = getSocketPath('C:\\some\\project');
    const b = getSocketPath('C:\\some\\project');
    expect(a).toBe(b);
  });

  it('normalizes case differences on win32 to the same path', () => {
    setPlatform('win32');
    const lower = getSocketPath('c:\\some\\project');
    const upper = getSocketPath('C:\\SOME\\PROJECT');
    expect(lower).toBe(upper);
  });

  it('produces different paths for different roots', () => {
    setPlatform('win32');
    const a = getSocketPath('C:\\project-a');
    const b = getSocketPath('C:\\project-b');
    expect(a).not.toBe(b);
  });

  it('returns a socket file path (not a named pipe) on non-windows platforms', () => {
    // Node's `path` module follows the real host OS regardless of a spoofed
    // process.platform, so on a Windows test runner this still produces a
    // backslash-joined path — assert on structure, not an exact separator.
    setPlatform('linux');
    const path = getSocketPath('C:\\some\\project');
    expect(path.endsWith('.mcp-telemetry.sock')).toBe(true);
    expect(path).not.toMatch(/^\\\\\.\\pipe\\/);
  });

  it('defaults to process.cwd() when no root is given', () => {
    setPlatform('win32');
    const explicit = getSocketPath(process.cwd());
    const defaulted = getSocketPath();
    expect(defaulted).toBe(explicit);
  });
});
