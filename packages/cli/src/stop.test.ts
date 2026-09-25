import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the modules stop() depends on BEFORE importing stop (vitest hoists
// vi.mock above imports). vi.hoisted keeps the mock fns reachable from both
// the factories and the test body.
const { killProcessOnPort, pidfile, execSyncMock } = vi.hoisted(() => {
  const killProcessOnPort = vi.fn(async () => {});
  const pidfile = { read: vi.fn(), remove: vi.fn() };
  const execSyncMock = vi.fn(() => '');
  return { killProcessOnPort, pidfile, execSyncMock };
});
vi.mock('./start.js', () => ({ killProcessOnPort: (...a: any[]) => killProcessOnPort(...a) }));
vi.mock('./tray/pidfile.js', () => pidfile);
vi.mock('node:child_process', () => ({ execSync: (...a: any[]) => execSyncMock(...a) }));

import { stop } from './stop.js';

describe('stop command', () => {
  const origPlatform = process.platform;
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true }); });

  it('no pidfile -> port-kill only', async () => {
    pidfile.read.mockReturnValue(null);
    await stop(8787);
    expect(killProcessOnPort).toHaveBeenCalledWith(8787);
    expect(pidfile.remove).toHaveBeenCalled();
  });

  it('pidfile present -> signals the parent, then port-kills', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    pidfile.read.mockReturnValue(4242);
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    await stop(8787);
    expect(kill).toHaveBeenCalledWith(4242, 'SIGTERM');
    expect(killProcessOnPort).toHaveBeenCalledWith(8787);
    kill.mockRestore();
  });

  it('pidfile present -> win32 uses taskkill', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    pidfile.read.mockReturnValue(4242);
    await stop(8787);
    expect(execSyncMock).toHaveBeenCalledWith(expect.stringContaining('taskkill /PID 4242'), expect.anything());
    expect(killProcessOnPort).toHaveBeenCalledWith(8787);
  });

  it('stale pidfile (ESRCH) falls through to port-kill without throwing', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    pidfile.read.mockReturnValue(99999);
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('no such process'), { code: 'ESRCH' }); });
    await expect(stop(8787)).resolves.toBeUndefined();
    expect(killProcessOnPort).toHaveBeenCalledWith(8787);
    expect(pidfile.remove).toHaveBeenCalled();
    kill.mockRestore();
  });
});
