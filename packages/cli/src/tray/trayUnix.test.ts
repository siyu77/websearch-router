import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

// We stub via the TrayRuntime seam (DIP) and mock node:child_process globally so
// the tray's spawn is captured without touching a real process. The fake stdout
// is a real EventEmitter so readline.createInterface gets a valid stream.

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: (...args: any[]) => spawnMock(...args) }));

import { initUnixTray, type TrayRuntime } from './trayUnix.js';
import type { TrayMenuItem } from './trayWin.js';

const items: TrayMenuItem[] = [{ title: 'Open', enabled: true, action: 'dashboard' }];

function fakeProc() {
  const stdout = new EventEmitter() as any;
  stdout.setEncoding = () => {};
  // readline calls resume/pause/destroy on the input stream
  stdout.resume = () => {};
  stdout.pause = () => {};
  stdout.destroy = () => {};
  return { stdin: { write: vi.fn() }, stdout, kill: vi.fn() };
}

describe('initUnixTray', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns null and warns when the binary cannot be resolved (degrade)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runtime: TrayRuntime = { resolveBin: () => null };
    const handle = initUnixTray({ tooltip: 't', items, onClick: () => {} }, runtime);
    expect(handle).toBeNull();
    expect(warn).toHaveBeenCalledWith('systray2 unavailable; running without tray.');
  });

  it('spawns the resolved binary and exposes updateItem/setTooltip/kill', () => {
    const runtime: TrayRuntime = { resolveBin: () => '/fake/systray2' };
    const proc = fakeProc();
    spawnMock.mockReturnValue(proc);
    const onClick = vi.fn();
    const handle = initUnixTray({ tooltip: 't', items, onClick }, runtime);
    expect(handle).not.toBeNull();
    expect(spawnMock).toHaveBeenCalledWith('/fake/systray2', [], { stdio: ['pipe', 'pipe', 'pipe'] });
    // add-item commands sent for each menu item
    expect(proc.stdin.write.mock.calls.length).toBeGreaterThan(0);
    // updateItem / setTooltip / kill forward to the proc
    handle!.updateItem(0, 'New', true);
    handle!.setTooltip('tt');
    handle!.kill();
    expect(proc.stdin.write.mock.calls.length).toBeGreaterThan(1);

    // a click line on stdout routes to the matching item action (readline
    // splits on newlines internally, so feed it a 'data' chunk)
    proc.stdout.emit('data', `${JSON.stringify({ type: 'click', index: 0 })}\n`);
    expect(onClick).toHaveBeenCalledWith('dashboard');
  });

  it('resolves the runtime exactly once per init (idempotent contract)', () => {
    let calls = 0;
    const runtime: TrayRuntime = { resolveBin: () => { calls++; return '/bin/systray2'; } };
    spawnMock.mockReturnValue(fakeProc());
    const handle = initUnixTray({ tooltip: 't', items, onClick: () => {} }, runtime);
    expect(handle).not.toBeNull();
    expect(calls).toBe(1); // present binary short-circuits; no re-install probe
  });
});
