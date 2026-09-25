import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildTrayMenuItems, initWinTray } from './trayWin.js';

const { spawnMock, sent } = vi.hoisted(() => {
  const sent: any[] = [];
  return {
    spawnMock: vi.fn(() => ({
      stdin: {
        write: (s: string) => { try { sent.push(JSON.parse(s)); } catch {} return true; },
      },
      stdout: { on: () => {}, resume: () => {} },
      stderr: { on: () => {} },
      on: () => {},
      kill: () => {},
    })),
    sent,
  };
});

vi.mock('node:child_process', () => ({ spawn: spawnMock }));

describe('trayWin menu', () => {
  beforeEach(() => { sent.length = 0; });

  it('builds the 4 required menu items with enabled flags', () => {
    const items = buildTrayMenuItems({ port: 8787, autostart: true });
    expect(items.map((i) => i.title)).toContain('Open Dashboard');
    expect(items.map((i) => i.title)).toContain('Enable Auto-start');
    const auto = items.find((i) => i.title.startsWith('Enable Auto-start'));
    expect(auto?.checked).toBe(true);
    expect(items.map((i) => i.title)).toContain('Quit');
    expect(items.some((i) => i.title.includes('Running on 8787'))).toBe(true);
  });

  it('sends add-item IPC commands carrying a checked key', () => {
    const items = buildTrayMenuItems({ port: 8787, autostart: true });
    initWinTray({ tooltip: 'websearch-router on 8787', items, onClick: () => {} });
    const addItems = sent.filter((c) => c.action === 'add-item');
    expect(addItems.length).toBe(items.length);
    for (const cmd of addItems) {
      expect(cmd).toHaveProperty('checked');
      expect(typeof cmd.checked).toBe('boolean');
    }
    const auto = addItems.find((c) => c.index === items.findIndex((i) => i.title.startsWith('Enable Auto-start')));
    expect(auto?.checked).toBe(true);
  });

  it('sends add-item commands only (no priming command) and all carry checked', () => {
    const items = buildTrayMenuItems({ port: 8787, autostart: false });
    initWinTray({ tooltip: 'websearch-router on 8787', items, onClick: () => {} });
    expect(sent.length).toBe(items.length);
    for (const cmd of sent) {
      expect(cmd.action).toBe('add-item');
      expect(cmd).toHaveProperty('checked');
    }
  });
});