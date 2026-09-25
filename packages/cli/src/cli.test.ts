import { describe, it, expect } from 'vitest';
import { parseArgs } from './cli.js';

describe('parseArgs', () => {
  it('parses command + string flag + boolean flag', () => {
    const r = parseArgs(['start', '--port', '8787', '--tray']);
    expect(r.command).toBe('start');
    expect(r.flags.port).toBe('8787');
    expect(r.flags.tray).toBe(true);
  });
});
